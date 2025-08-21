/**
 * Bird Sound Spectrogram Visualizer
 * 核心功能模块 - 音频处理和WebGL渲染
 */

class SpectrogramVisualizer {
    constructor() {
        // DOM 元素
        this.canvas = document.getElementById('canvas');
        
        // Three.js 核心对象
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        // 音频相关
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isRecording = false;
        
        // 参数配置
        this.config = {
            fftSize: 1024,
            melBands: 256,
            smoothing: 0.5,
            bloomIntensity: 0.7,
            //colorTemp: 6500,
            scrollSpeed: 1.0,
            spectrogramWidth: 600, // 频谱图宽度（时间维度）
            exposure: 1.2,      // 曝光度
            gamma: 1.0,         // Gamma 校正
        };
        
        // 数据存储
        this.spectrogramData = [];
        this.spectrogramTexture = null;
        this.spectrogramMaterial = null;
        this.melFilterBank = null;
        
        // 初始化
        this.init();
    }

    /**
     * 初始化所有模块
     */
    async init() {
        try {
            this.initThree();
            await this.initAudio();
            this.createMelFilterBank();
            this.initControls();
            this.animate();
            console.log('✅ Spectrogram visualizer initialized successfully');
        } catch (error) {
            console.error('❌ Initialization failed:', error);
        }
    }

    /**
     * 初始化 Three.js 场景
     */
    initThree() {
        console.log('🎬 Initializing Three.js...');
        
        // 检查WebGL支持
        if (!window.WebGLRenderingContext) {
            console.error('❌ WebGL not supported');
            alert('您的浏览器不支持WebGL，无法显示频谱图');
            return;
        }

        // 创建场景
        this.scene = new THREE.Scene();
        console.log('✅ Scene created');

        // 创建正交相机（2D视图）
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.OrthographicCamera(
            -aspect, aspect, 1, -1, 0.1, 1000
        );
        this.camera.position.z = 1;
        console.log('✅ Camera created');

        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: true,
            alpha: true,
            context: this.canvas.getContext('webgl2')
        });
        
        if (!this.renderer) {
            console.error('❌ WebGL renderer creation failed');
            return;
        }
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        console.log('✅ Renderer created');

        // 创建频谱图平面
        this.createSpectrogramPlane();

        // 窗口大小变化处理
        window.addEventListener('resize', () => this.onWindowResize());
        
        console.log('✅ Three.js initialization complete');
    }

    /**
     * 创建频谱图渲染平面
     */
 createSpectrogramPlane() {
    console.log('🎨 Creating spectrogram plane...');
    
    // 创建数据纹理
    const textureData = new Uint8Array(this.config.spectrogramWidth * this.config.melBands * 4);
    
    // 填充一些测试数据，确保纹理可见
    for (let i = 0; i < textureData.length; i += 4) {
        textureData[i] = 0;     // R
        textureData[i + 1] = 0; // G
        textureData[i + 2] = 0; // B
        textureData[i + 3] = 255; // A
    }
    
    this.spectrogramTexture = new THREE.DataTexture(
        textureData, 
        this.config.spectrogramWidth, 
        this.config.melBands, 
        THREE.RGBAFormat
    );
    this.spectrogramTexture.minFilter = THREE.LinearFilter;
    this.spectrogramTexture.magFilter = THREE.LinearFilter;
    this.spectrogramTexture.needsUpdate = true;
    console.log('✅ Texture created');

    // WebGL1 兼容的顶点着色器
    const vertexShader = `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`;

            // WebGL1 兼容的片元着色器 - 修复 'sample' 保留字问题
            const fragmentShader = `
        precision highp float;

        uniform sampler2D spectrogramTexture;
        uniform float bloomIntensity;
        uniform float time;
        uniform vec2 textureSize;
        uniform float exposure;    // 新增：曝光度
        uniform float gamma;       // 新增：Gamma 校正

        varying vec2 vUv;

        // IQ调色板函数
        vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
            return a + b * cos(6.28318 * (c * t + d));
        }

        // 改进的噪声函数
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        vec3 spectrogramColor(float intensity) {
            if (intensity < 0.01) {
                return vec3(0.0);
            }
            
            // 使用你的颜色 + IQ调色板混合
            vec3 dark = vec3(0.28, 0.27, 0.91);
            vec3 mid = vec3(0.8, 0.36, 0.57);
            vec3 bright = vec3(0.88, 0.43, 0.35);
            vec3 core = vec3(0.86, 0.47, 0.28);
            
            vec3 color;
            if (intensity < 0.25) {
                float t = smoothstep(0.0, 0.25, intensity);
                color = mix(dark, mid, t);
            } else if (intensity < 0.6) {
                float t = smoothstep(0.25, 0.6, intensity);
                color = mix(mid, bright, t);
            } else {
                float t = smoothstep(0.6, 1.0, intensity);
                color = mix(bright, core, t);
            }
            
            // 添加IQ调色板增强
            vec3 iqColor = palette(intensity + time * 0.1,
                                vec3(0.5, 0.5, 0.5),
                                vec3(0.3, 0.3, 0.3),
                                vec3(1.0, 1.0, 0.5),
                                vec3(0.8, 0.9, 0.3));
            
            // 混合两种颜色系统
            color = mix(color, iqColor, 0.3 * intensity);
            
            // 边缘软化
            float softEdge = smoothstep(0.0, 0.05, intensity);
            color *= softEdge;
            
            return color;
        }

        void main() {
            vec2 uv = vUv;
            vec4 texel = texture2D(spectrogramTexture, uv);
            float intensity = texel.r;
            
            // 高级色差效果
            float aberrationStrength = intensity * 0.004 + 0.003 * sin(fract(time) * 2.0);
            
            // 分别采样RGB，加入时间偏移
            float intensityR = texture2D(spectrogramTexture, uv + vec2(-aberrationStrength, 0.0)).r;
            float intensityG = intensity;
            float intensityB = texture2D(spectrogramTexture, uv + vec2(aberrationStrength, 0.0)).r;
            
            vec3 colorR = spectrogramColor(intensityR);
            vec3 colorG = spectrogramColor(intensityG);
            vec3 colorB = spectrogramColor(intensityB);
            
            vec3 chromaticColor = vec3(colorR.r, colorG.g, colorB.b);
            vec3 originalColor = spectrogramColor(intensity);
            vec3 color = mix(originalColor, chromaticColor, 0.6);
            
            // Bloom - 使用手动传入的纹理尺寸
            vec2 texelSize = 1.0 / textureSize;
            float bloom = 0.0;
            
            // 高斯模糊般的bloom
            for (int x = -3; x <= 3; x++) {
                for (int y = -3; y <= 3; y++) {
                    vec2 offset = vec2(float(x), float(y)) * texelSize;
                    float sampleValue = texture2D(spectrogramTexture, uv + offset).r; 
                    float weight = exp(-float(x*x + y*y) * 0.2);
                    bloom += sampleValue * weight;  // 使用新名称
                }
            }
            bloom *= bloomIntensity * 0.02;
            
            // 添加噪声细节
            float noiseDetail = noise(vec2(uv.x, uv.y * 512.0)) * 0.05 * intensity;
            color *= noiseDetail * (50.0 * (0.5 + sin(fract(time)) * 0.5));
            color = clamp(color, 0.0, 1.0);

            // Bloom也应用相同颜色映射
            vec3 bloomColor = spectrogramColor(bloom);
            color += bloomColor * bloomIntensity + color * bloomColor;
            
            // 添加动态效果
            float shimmer = 1.0 + (1.0 - 0.5 * sin(fract(time) + uv.x * 5.0)) * intensity;
            color *= vec3(shimmer );
            color = pow(color, vec3(1.0 / gamma)) * exposure;
            color = clamp(color, 0.0, 1.0);
            
            gl_FragColor = vec4(color, 1.0);
        }`;

        this.spectrogramMaterial = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                spectrogramTexture: { value: this.spectrogramTexture },
                bloomIntensity: { value: this.config.bloomIntensity },
                time: { value: 0 },
                textureSize: { 
                    value: new THREE.Vector2(
                        this.config.spectrogramWidth, 
                        this.config.melBands
                    ) 
                },
                exposure: { value: this.config.exposure },
                gamma: { value: this.config.gamma }
            }
    });
    
    console.log('✅ Material created with ShaderMaterial');

    // 创建平面几何体和网格
    const geometry = new THREE.PlaneGeometry(1.8, 1.6);
    const mesh = new THREE.Mesh(geometry, this.spectrogramMaterial);
    this.scene.add(mesh);
    
    console.log('✅ Mesh added to scene');
}

    /**
     * 初始化音频系统
     */
    async initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.config.fftSize;
            this.analyser.smoothingTimeConstant = this.config.smoothing;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            console.log('🎵 Audio system initialized');
        } catch (error) {
            console.error('❌ Audio initialization failed:', error);
            throw error;
        }
    }

    /**
     * 创建 Mel 滤波器组
     */
    createMelFilterBank() {
        const sampleRate = 44100;
        const nfft = this.config.fftSize / 2;
        const nMels = this.config.melBands;
        
        // Mel 尺度转换函数
        const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
        const melToHz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);
        
        // 创建 Mel 刻度点
        const melMin = hzToMel(500);
        const melMax = hzToMel(sampleRate / 2);
        const melPoints = [];
        for (let i = 0; i <= nMels + 1; i++) {
            melPoints.push(melMin + (melMax - melMin) * i / (nMels + 1));
        }
        
        // 转换回 Hz
        const hzPoints = melPoints.map(melToHz);
        
        // 创建滤波器组
        this.melFilterBank = [];
        for (let m = 1; m <= nMels; m++) {
            const filter = new Array(nfft).fill(0);
            const left = hzPoints[m - 1];
            const center = hzPoints[m];
            const right = hzPoints[m + 1];
            
            for (let k = 0; k < nfft; k++) {
                const freq = k * sampleRate / (2 * nfft);
                
                if (freq >= left && freq <= center) {
                    filter[k] = (freq - left) / (center - left);
                } else if (freq > center && freq <= right) {
                    filter[k] = (right - freq) / (right - center);
                }
            }
            this.melFilterBank.push(filter);
        }
        
        console.log(`🔧 Mel filter bank created: ${nMels} bands`);
    }

    /**
     * 初始化控制事件
     */
    initControls() {
        // 录音控制
        document.getElementById('startBtn').addEventListener('click', () => this.startRecording());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopRecording());
        
        // 文件上传
        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files[0]) this.loadAudioFile(e.target.files[0]);
        });

        // 参数控制
        this.setupParameterControls();
    }

    /**
     * 设置参数控制
     */
    setupParameterControls() {
        // FFT 大小
        document.getElementById('fftSize').addEventListener('change', (e) => {
            this.config.fftSize = parseInt(e.target.value);
            this.reinitializeAudio();
            this.createMelFilterBank();
        });

        // Mel 频带数
        document.getElementById('melBands').addEventListener('input', (e) => {
            this.config.melBands = parseInt(e.target.value);
            document.getElementById('melBandsValue').textContent = this.config.melBands;
            this.createMelFilterBank();
            this.recreateTexture();
        });

        // 平滑度
        document.getElementById('smoothing').addEventListener('input', (e) => {
            this.config.smoothing = parseFloat(e.target.value);
            document.getElementById('smoothingValue').textContent = this.config.smoothing;
            if (this.analyser) this.analyser.smoothingTimeConstant = this.config.smoothing;
        });

        // Bloom 强度
        document.getElementById('bloomIntensity').addEventListener('input', (e) => {
            this.config.bloomIntensity = parseFloat(e.target.value);
            document.getElementById('bloomValue').textContent = this.config.bloomIntensity;
            if (this.spectrogramMaterial) {
                this.spectrogramMaterial.uniforms.bloomIntensity.value = this.config.bloomIntensity;
            }
        });

        // // 滚动速度
        // document.getElementById('scrollSpeed').addEventListener('input', (e) => {
        //     this.config.scrollSpeed = parseFloat(e.target.value);
        //     document.getElementById('scrollSpeedValue').textContent = this.config.scrollSpeed;
        // });

        const exposureControl = document.getElementById('exposure');
        if (exposureControl) {
            exposureControl.addEventListener('input', (e) => {
                this.config.exposure = parseFloat(e.target.value);
                document.getElementById('exposureValue').textContent = this.config.exposure.toFixed(1);
                if (this.spectrogramMaterial) {
                    this.spectrogramMaterial.uniforms.exposure.value = this.config.exposure;
                }
            });
        }

        // Gamma 控制
        const gammaControl = document.getElementById('gamma');
        if (gammaControl) {
            gammaControl.addEventListener('input', (e) => {
                this.config.gamma = parseFloat(e.target.value);
                document.getElementById('gammaValue').textContent = this.config.gamma.toFixed(1);
                if (this.spectrogramMaterial) {
                    this.spectrogramMaterial.uniforms.gamma.value = this.config.gamma;
                }
            });
        }
    }

    /**
     * 开始录音
     */
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            
            this.isRecording = true;
            this.spectrogramData = [];
            
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            
            console.log('🎤 Recording started');
        } catch (error) {
            console.error('❌ Microphone access failed:', error);
            alert('无法访问麦克风，请检查权限设置');
        }
    }

    /**
     * 停止录音
     */
    stopRecording() {
        this.isRecording = false;
        
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.suspend();
        }
        
        console.log('⏹ Recording stopped');
    }

    /**
     * 加载音频文件
     */
    async loadAudioFile(file) {
        const loading = document.getElementById('loading');
        loading.classList.remove('hidden');
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.analyser);
            
            this.spectrogramData = [];
            this.isRecording = true;
            
            source.start();
            
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            
            // 自动停止
            setTimeout(() => {
                this.stopRecording();
            }, audioBuffer.duration * 1000);
            
            console.log(`📁 Audio file loaded: ${file.name}`);
        } catch (error) {
            console.error('❌ Audio file loading failed:', error);
            alert('音频文件加载失败');
        } finally {
            loading.classList.add('hidden');
        }
    }

    /**
     * 重新初始化音频分析器
     */
    reinitializeAudio() {
        if (this.analyser) {
            this.analyser.fftSize = this.config.fftSize;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    /**
     * 重新创建纹理
     */
recreateTexture() {
    const textureData = new Uint8Array(this.config.spectrogramWidth * this.config.melBands * 4);
    this.spectrogramTexture.dispose();
    this.spectrogramTexture = new THREE.DataTexture(
        textureData, 
        this.config.spectrogramWidth, 
        this.config.melBands, 
        THREE.RGBAFormat
    );
    this.spectrogramTexture.minFilter = THREE.LinearFilter;
    this.spectrogramTexture.magFilter = THREE.LinearFilter;
    this.spectrogramMaterial.uniforms.spectrogramTexture.value = this.spectrogramTexture;
    
    // 更新纹理尺寸
    this.spectrogramMaterial.uniforms.textureSize.value = new THREE.Vector2(
        this.config.spectrogramWidth, 
        this.config.melBands
    );
    
    this.spectrogramData = [];
}

    /**
     * 应用 Mel 滤波
     */
    applyMelFiltering(fftData) {
        const melData = new Array(this.config.melBands);
        
        for (let m = 0; m < this.config.melBands; m++) {
            let sum = 0;
            for (let k = 0; k < fftData.length; k++) {
                sum += fftData[k] * this.melFilterBank[m][k];
            }
            melData[m] = sum / 255.0; // 归一化到 0-1
        }
        
        return melData;
    }

    /**
     * 更新频谱图数据
     */
    updateSpectrogram() {
        if (!this.isRecording || !this.analyser) return;

        // 获取频域数据
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // 应用 Mel 滤波
        const melData = this.applyMelFiltering(this.dataArray);
        
        // 添加到频谱图数据
        this.spectrogramData.push(melData);
        
        // 保持数据长度
        if (this.spectrogramData.length > this.config.spectrogramWidth) {
            this.spectrogramData.shift();
        }

        // 更新纹理
        this.updateTexture();
    }

    /**
     * 更新纹理数据
     */
    updateTexture() {
        if (!this.spectrogramTexture || this.spectrogramData.length === 0) return;

        const textureData = this.spectrogramTexture.image.data;
        
        // 将现有数据向左移动一列
        for (let y = 0; y < this.config.melBands; y++) {
            for (let x = 0; x < this.config.spectrogramWidth - 1; x++) {
                const srcIndex = ((y * this.config.spectrogramWidth + x + 1) * 4);
                const dstIndex = ((y * this.config.spectrogramWidth + x) * 4);
                textureData[dstIndex] = textureData[srcIndex];
                textureData[dstIndex + 1] = textureData[srcIndex + 1];
                textureData[dstIndex + 2] = textureData[srcIndex + 2];
                textureData[dstIndex + 3] = textureData[srcIndex + 3];
            }
        }
        
        // 添加新的一列数据
        const latestData = this.spectrogramData[this.spectrogramData.length - 1];
        for (let y = 0; y < this.config.melBands; y++) {
            const intensity = Math.min(1.0, latestData[y] || 0);
            const pixelIndex = (y * this.config.spectrogramWidth + (this.config.spectrogramWidth - 1)) * 4;
            
            const value = Math.floor(intensity * 255);
            textureData[pixelIndex] = value;     // R
            textureData[pixelIndex + 1] = value; // G
            textureData[pixelIndex + 2] = value; // B
            textureData[pixelIndex + 3] = 255;   // A
        }
        
        this.spectrogramTexture.needsUpdate = true;
    }

    /**
     * 动画循环
     */
    animate() {
        requestAnimationFrame(() => this.animate());

        const time = Date.now() * 0.001 * this.config.scrollSpeed;

        // 更新频谱图
        this.updateSpectrogram();

        // 更新着色器时间
        if (this.spectrogramMaterial) {
            this.spectrogramMaterial.uniforms.time.value = time;
        }

        // 使用后处理渲染
        if (this.composer) {
            this.composer.render();
        } else {
            // 降级到普通渲染
            this.renderer.render(this.scene, this.camera);
        }
    }


    /**
     * 窗口大小变化处理
     */
    onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        this.camera.left = -aspect;
        this.camera.right = aspect;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// 页面加载完成后初始化
window.addEventListener('load', () => {
    console.log('🚀 Initializing Bird Sound Spectrogram Visualizer...');
    new SpectrogramVisualizer();
});