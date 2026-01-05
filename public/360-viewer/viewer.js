// THREE変数はグローバルスコープから利用

// WebGLコンテキストの管理用
const MAX_ACTIVE_VIEWERS = 3; // 同時に表示する最大ビューアー数
const activeViewers = new Set();

// デバッグモード（開発時のみtrueに設定）
const DEBUG_MODE = false;

// グローバルなデバイス情報（一度だけ判定）
let globalDeviceInfo = null;

// グローバルなWebGL設定（一度だけ決定）
let globalWebGLConfig = null;

// デバイス情報を一度だけ取得する関数
function getGlobalDeviceInfo() {
    if (globalDeviceInfo) {
        return globalDeviceInfo;
    }

    globalDeviceInfo = {
        isMobile: detectMobileDevice(),
        isMac: /Mac|Macintosh|MacIntel|MacPPC|Mac68K/i.test(navigator.userAgent),
        webglSupported: detectWebGLSupport(),
        hardwareAccelerationEnabled: detectHardwareAcceleration(),
        userAgent: navigator.userAgent
    };

    if (DEBUG_MODE) {
        console.log('Global device info detected:', globalDeviceInfo);
    }

    return globalDeviceInfo;
}

// WebGL設定を一度だけ取得する関数
function getGlobalWebGLConfig() {
    if (globalWebGLConfig) {
        return globalWebGLConfig;
    }

    const deviceInfo = getGlobalDeviceInfo();

    globalWebGLConfig = {
        rendererOptions: {
            antialias: true,
            preserveDrawingBuffer: true
        },
        pixelRatio: 1.0
    };

    // モバイルデバイス用の設定
    if (deviceInfo.isMobile) {
        globalWebGLConfig.rendererOptions.powerPreference = 'low-power';
        // failIfMajorPerformanceCaveatを削除（WebGLが動作しない原因の可能性）
        globalWebGLConfig.rendererOptions.antialias = false; // アンチエイリアスを無効化
        globalWebGLConfig.rendererOptions.preserveDrawingBuffer = false; // 描画バッファを保持しない
        globalWebGLConfig.pixelRatio = Math.min(window.devicePixelRatio, 1.5); // 1.5に緩和
        if (DEBUG_MODE) {
            console.log('Global WebGL config: Mobile-optimized settings (WebGL enabled)');
        }
    } else if (deviceInfo.hardwareAccelerationEnabled) {
        if (deviceInfo.isMac) {
            globalWebGLConfig.rendererOptions.powerPreference = 'high-performance'; // Macでは高パフォーマンスを優先
            globalWebGLConfig.pixelRatio = Math.min(window.devicePixelRatio, 3); // Macではより高い解像度を許可
        } else {
            globalWebGLConfig.rendererOptions.powerPreference = 'low-power'; // 他のデバイスでは電力消費を考慮
            globalWebGLConfig.pixelRatio = Math.min(window.devicePixelRatio, 2); // 他のデバイスでは制限
        }
    } else {
        // ハードウェアアクセラレーションが無効の場合はソフトウェアレンダリングを許可
        globalWebGLConfig.rendererOptions.powerPreference = 'low-power';
        globalWebGLConfig.rendererOptions.failIfMajorPerformanceCaveat = false;
        globalWebGLConfig.pixelRatio = 1;
        if (DEBUG_MODE) {
            console.warn('Global WebGL config: Software rendering mode');
        }
    }

    if (DEBUG_MODE) {
        console.log('Global WebGL config:', globalWebGLConfig);
    }

    return globalWebGLConfig;
}

// デバイス判定関数（グローバル）
function detectMobileDevice() {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const windowWidth = window.innerWidth;

    const result = {
        hasTouch,
        mobileUA,
        isMac: /Mac|Macintosh|MacIntel|MacPPC|Mac68K/i.test(navigator.userAgent),
        windowWidth,
        userAgent: navigator.userAgent
    };

    if (DEBUG_MODE) {
        console.log('Mobile Detection:', result);
    }

    return hasTouch && (mobileUA || windowWidth <= 768);
}

// WebGLサポート検出（グローバル）
function detectWebGLSupport() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        if (!gl) {
            if (DEBUG_MODE) {
                console.warn('WebGL not supported: No WebGL context available');
            }
            return false;
        }

        // WebGLの基本機能をテスト
        const testProgram = gl.createProgram();
        if (!testProgram) {
            if (DEBUG_MODE) {
                console.warn('WebGL not supported: Cannot create WebGL program');
            }
            return false;
        }

        // テスト用のシェーダーを作成
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

        if (!vertexShader || !fragmentShader) {
            if (DEBUG_MODE) {
                console.warn('WebGL not supported: Cannot create shaders');
            }
            return false;
        }

        // リソースをクリーンアップ
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl.deleteProgram(testProgram);

        if (DEBUG_MODE) {
            console.log('WebGL support confirmed');
        }

        return true;
    } catch (e) {
        if (DEBUG_MODE) {
            console.warn('WebGL not supported:', e.message);
        }
        return false;
    }
}

// ハードウェアアクセラレーション検出（グローバル）
function detectHardwareAcceleration() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return false;

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
            return !renderer.toLowerCase().includes('software');
        }
        return true;
    } catch (e) {
        return false;
    }
}

class PanoramaViewer {
    constructor(container, imageUrl) {
        this.container = container;
        this.imageUrl = imageUrl;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.sphere = null;
        this.isUserInteracting = false;
        this.onMouseDownMouseX = 0;
        this.onMouseDownMouseY = 0;
        this.lon = 90;
        this.lat = 0;
        this.onMouseDownLon = 0;
        this.onMouseDownLat = 0;
        this.phi = 0;
        this.theta = 0;
        this.autoRotate = true;
        this.autoRotateTimeout = null;
        this.isFullscreen = false;
        this.isDisposed = false;
        this.isVisible = true; // 画面内に表示されているか
        this.intersectionObserver = null; // Intersection Observer

        // 時間ベースの自動回転用（フレームレート非依存）
        this.lastTime = 0;
        this.autoRotateSpeed = 3;

        // グローバルなデバイス情報を使用
        const deviceInfo = getGlobalDeviceInfo();
        this.isMobile = deviceInfo.isMobile;
        this.isMac = deviceInfo.isMac;
        this.webglSupported = deviceInfo.webglSupported;
        this.hardwareAccelerationEnabled = deviceInfo.hardwareAccelerationEnabled;

        // バインド済みメソッドを保存（イベントリスナー削除用）
        this.boundOnDocumentMouseDown = this.onDocumentMouseDown.bind(this);
        this.boundOnDocumentMouseMove = this.onDocumentMouseMove.bind(this);
        this.boundOnDocumentMouseUp = this.onDocumentMouseUp.bind(this);
        this.boundOnDocumentTouchStart = this.onDocumentTouchStart.bind(this);
        this.boundOnDocumentTouchMove = this.onDocumentTouchMove.bind(this);
        this.boundOnDocumentTouchEnd = this.onDocumentTouchEnd.bind(this);
        this.boundOnWindowResize = this.onWindowResize.bind(this);
        this.boundHandleFullscreenChange = this.handleFullscreenChange.bind(this);
        this.boundHandleEscapeKey = this.handleEscapeKey.bind(this);
        this.boundHandleBeforeUnload = this.dispose.bind(this);
        this.boundPreventScroll = this.preventScroll.bind(this);
        this.boundOnContainerClick = this.onContainerClick.bind(this);
        this.boundHandleContextLost = this.handleContextLost.bind(this);
        this.boundHandleContextRestored = this.handleContextRestored.bind(this);

        // ボタンイベントハンドラーの保存用
        this.boundZoomInClick = null;
        this.boundZoomOutClick = null;
        this.boundZoomInTouch = null;
        this.boundZoomOutTouch = null;
        this.boundFullscreenClick = null;

        // Intersection Observer の設定
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.activate();
                    } else {
                        this.deactivate();
                    }
                });
            },
            { threshold: 0.1 } // 10%以上表示されたら反応
        );

        // デバッグ情報の表示
        if (DEBUG_MODE) {
            console.log('360°ビューアーを初期化中...');
            console.log('システム情報:', {
                isMobile: this.isMobile,
                isMac: this.isMac,
                webglSupported: this.webglSupported,
                hardwareAccelerationEnabled: this.hardwareAccelerationEnabled,
                userAgent: navigator.userAgent,
                hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0
            });
        }

        if (!this.webglSupported && DEBUG_MODE) {
            console.warn('WebGLがサポートされていません。Canvas2Dフォールバックを使用します。');
        } else if (!this.hardwareAccelerationEnabled && DEBUG_MODE) {
            console.warn('ハードウェアアクセラレーションが無効です。ソフトウェアレンダリングを使用します。');
        }

        this.init();
        this.setupIntersectionObserver();
    }


    // Intersection Observerのセットアップ（メモリ最適化）
    setupIntersectionObserver() {
        if (!('IntersectionObserver' in window)) {
            if (DEBUG_MODE) {
                console.log('IntersectionObserver not supported, skipping visibility optimization');
            }
            return;
        }

        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                this.isVisible = entry.isIntersecting;
                if (this.isVisible) {
                    if (DEBUG_MODE) {
                        console.log('Viewer became visible, resuming animation');
                    }
                    this.startAnimation();
                } else {
                    if (DEBUG_MODE) {
                        console.log('Viewer became hidden, pausing animation');
                    }
                    this.stopAnimation();
                }
            });
        }, {
            threshold: 0.1 // 10%表示されたら可視とみなす
        });

        this.intersectionObserver.observe(this.container);
    }

    init() {
        try {
            // シーンの作成
            this.scene = new THREE.Scene();

            // カメラの作成
            this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 1, 1100);
            this.camera.target = new THREE.Vector3(0, 0, 0);

            // レンダラーの作成（フォールバック対応）
            this.renderer = this.createRenderer();
            this.container.appendChild(this.renderer.domElement);

            // WebGLコンテキスト損失イベントのリスナーを追加
            if (!this.renderer.isCanvas2D) {
                this.renderer.domElement.addEventListener('webglcontextlost', this.boundHandleContextLost, false);
                this.renderer.domElement.addEventListener('webglcontextrestored', this.boundHandleContextRestored, false);
            }
        } catch (error) {
            console.error('ビューアーの初期化に失敗しました:', error);
            this.showErrorMessage('360°ビューアーの初期化に失敗しました。');
            return;
        }

        // コントロールボタンのコンテナ作成
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = 'psv-controls-container';
        this.container.appendChild(this.controlsContainer);

        // 16:9画像用に調整した球体ジオメトリの作成
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);

        // テクスチャの読み込みと調整
        const textureLoader = new THREE.TextureLoader();

        // Three.js r152以降ではcolorSpaceを使用、それ以前はencodingを使用
        const useColorSpace = THREE.SRGBColorSpace !== undefined;

        if (!useColorSpace) {
            textureLoader.encoding = THREE.sRGBEncoding;
        }

        const texture = textureLoader.load(
            this.imageUrl,
            // onLoad
            () => {
                // Three.js r152以降の新しいAPI
                if (useColorSpace) {
                    texture.colorSpace = THREE.SRGBColorSpace;
                } else {
                    // 古いバージョン用
                    texture.encoding = THREE.sRGBEncoding;
                }

                texture.wrapS = THREE.RepeatWrapping;
                texture.repeat.x = 1.0;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.generateMipmaps = false;  // ミップマップを無効化して元の色を保持

                const material = new THREE.MeshBasicMaterial({
                    map: texture,
                    side: THREE.DoubleSide
                });

                this.sphere = new THREE.Mesh(geometry, material);
                this.scene.add(this.sphere);
            },
            // onProgress
            undefined,
            // onError
            (error) => {
                console.error('テクスチャの読み込みに失敗しました:', error);
                this.showErrorMessage('360°画像の読み込みに失敗しました。画像のURLを確認してください。');
            }
        );

        // Intersection Observer の開始
        this.observer.observe(this.container);

        // イベントリスナーの設定
        this.setupEventListeners();

        // アクティブビューアーとして登録
        this.activate();
    }

    // WebGLコンテキスト損失時の処理
    handleContextLost(event) {
        event.preventDefault();
        if (DEBUG_MODE) {
            console.warn('WebGLコンテキストが失われました');
        }
        this.stopAnimation();

        // モバイルではCanvas2Dフォールバックに切り替え
        if (this.isMobile && this.webglSupported) {
            if (DEBUG_MODE) {
                console.log('Mobile device - attempting Canvas2D fallback');
            }
            this.showErrorMessage('WebGLが利用できません。Canvas2Dモードに切り替えます...');
            setTimeout(() => {
                this.switchToCanvas2D();
            }, 1000);
        }
    }

    // WebGLコンテキスト復元時の処理
    handleContextRestored() {
        if (DEBUG_MODE) {
            console.log('WebGLコンテキストが復元されました');
        }
        this.startAnimation();
    }

    // Canvas2Dフォールバックに切り替え
    switchToCanvas2D() {
        if (DEBUG_MODE) {
            console.log('Switching to Canvas2D fallback');
        }

        // WebGLレンダラーを削除
        if (this.renderer && this.renderer.domElement) {
            this.container.removeChild(this.renderer.domElement);
        }

        // Canvas2Dレンダラーを作成
        this.renderer = this.createCanvas2DRenderer();
        this.container.appendChild(this.renderer.domElement);

        // アニメーションを再開
        this.startAnimation();

        if (DEBUG_MODE) {
            console.log('Canvas2D fallback activated');
        }
    }

    // WebGLレンダラーの作成（フォールバック対応）
    createRenderer() {
        // WebGLサポートの確認
        if (!this.webglSupported) {
            if (DEBUG_MODE) {
                console.warn('WebGLがサポートされていません。Canvas2Dフォールバックを使用します。');
            }
            return this.createCanvas2DRenderer();
        }

        try {
            // グローバルなWebGL設定を使用
            const webglConfig = getGlobalWebGLConfig();

            if (DEBUG_MODE) {
                console.log('Creating WebGL renderer with config:', webglConfig.rendererOptions);
            }

            let renderer;

            // モバイルでは複数の設定を試す
            if (this.isMobile) {
                const configs = [
                    webglConfig.rendererOptions, // 元の設定
                    { antialias: false, preserveDrawingBuffer: false }, // 最小設定
                    { antialias: false }, // さらに最小設定
                    {} // デフォルト設定
                ];

                for (let i = 0; i < configs.length; i++) {
                    try {
                        if (DEBUG_MODE) {
                            console.log(`Trying WebGL config ${i + 1}:`, configs[i]);
                        }
                        renderer = new THREE.WebGLRenderer(configs[i]);

                        // WebGLレンダラーが正常に作成されたかチェック
                        if (renderer && renderer.domElement && renderer.getContext()) {
                            if (DEBUG_MODE) {
                                console.log(`WebGL renderer created successfully with config ${i + 1}`);
                            }
                            break;
                        } else {
                            throw new Error(`WebGL renderer creation failed with config ${i + 1}`);
                        }
                    } catch (configError) {
                        if (DEBUG_MODE) {
                            console.warn(`WebGL config ${i + 1} failed:`, configError.message);
                        }
                        if (i === configs.length - 1) {
                            throw configError; // 最後の設定でも失敗した場合
                        }
                    }
                }
            } else {
                // デスクトップでは通常の設定
                renderer = new THREE.WebGLRenderer(webglConfig.rendererOptions);

                // WebGLレンダラーが正常に作成されたかチェック
                if (!renderer || !renderer.domElement || !renderer.getContext()) {
                    throw new Error('WebGL renderer creation failed');
                }
            }

            // グローバルなピクセル比設定を使用
            renderer.setPixelRatio(webglConfig.pixelRatio);
            if (DEBUG_MODE) {
                console.log('WebGL renderer created successfully - pixel ratio:', webglConfig.pixelRatio);
            }

            renderer.setSize(this.container.clientWidth, this.container.clientHeight);

            // Three.js r152以降では outputEncoding と gammaOutput は非推奨
            // 新しいバージョンでは outputColorSpace を使用
            if (THREE.SRGBColorSpace !== undefined) {
                renderer.outputColorSpace = THREE.SRGBColorSpace;
            } else {
                // 古いバージョン用
                renderer.outputEncoding = THREE.sRGBEncoding;
                renderer.gammaFactor = 2.2;
                // renderer.gammaOutput = true; // Removed for r128+ compatibility
            }

            return renderer;
        } catch (error) {
            console.error('WebGLレンダラーの作成に失敗しました:', error);
            if (DEBUG_MODE) {
                console.warn('WebGL initialization failed, switching to Canvas2D fallback');
                console.warn('Error details:', error.message);
                console.warn('Device info:', {
                    isMobile: this.isMobile,
                    webglSupported: this.webglSupported,
                    hardwareAccelerationEnabled: this.hardwareAccelerationEnabled,
                    userAgent: navigator.userAgent
                });
            }
            return this.createCanvas2DRenderer();
        }
    }

    // Canvas2Dフォールバックレンダラーの作成
    createCanvas2DRenderer() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = this.container.clientWidth;
        canvas.height = this.container.clientHeight;

        // Canvas2Dレンダラーのラッパーオブジェクト
        const renderer = {
            domElement: canvas,
            context: ctx,
            isCanvas2D: true,

            setSize: function (width, height) {
                canvas.width = width;
                canvas.height = height;
            },

            setPixelRatio: function (ratio) {
                // Canvas2Dではピクセル比の設定は無視
            },

            render: function (scene, camera) {
                // Canvas2Dでの描画処理
                this.renderCanvas2D(scene, camera);
            }.bind(this),

            dispose: function () {
                // Canvas2Dのクリーンアップ
                canvas.remove();
            }
        };

        return renderer;
    }

    // Canvas2Dでの描画処理
    renderCanvas2D(scene, camera) {
        if (!this.renderer.isCanvas2D || !this.sphere) return;

        const ctx = this.renderer.context;
        const canvas = this.renderer.domElement;

        // キャンバスをクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 360°画像の描画
        if (this.sphere && this.sphere.material && this.sphere.material.map) {
            const texture = this.sphere.material.map;
            const image = texture.image;

            if (image && image.complete) {
                // 球面投影をCanvas2Dで近似
                this.drawPanoramaOnCanvas(ctx, image, canvas.width, canvas.height);
            }
        }
    }

    // Canvas2Dでのパノラマ描画（WebGL互換版）
    drawPanoramaOnCanvas(ctx, image, width, height) {
        // キャンバスをクリア
        ctx.clearRect(0, 0, width, height);

        // 一時キャンバスに画像を描画して、ピクセルデータを取得
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(image, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, image.width, image.height);
        const pixels = imageData.data;

        // カメラの設定（WebGLと同じ）
        const fov = this.camera.fov;
        const aspect = width / height;

        // 球面座標からスクリーン座標への変換
        const phi = THREE.MathUtils.degToRad(90 - this.lat);
        const theta = THREE.MathUtils.degToRad(this.lon);

        // カメラの位置（WebGLと同じ）
        const cameraX = 100 * Math.sin(phi) * Math.cos(theta);
        const cameraY = 100 * Math.cos(phi);
        const cameraZ = 100 * Math.sin(phi) * Math.sin(theta);

        // カメラの向き
        const cameraDirX = -cameraX;
        const cameraDirY = -cameraY;
        const cameraDirZ = -cameraZ;
        const cameraDirLength = Math.sqrt(cameraDirX * cameraDirX + cameraDirY * cameraDirY + cameraDirZ * cameraDirZ);
        const cameraDirNormX = cameraDirX / cameraDirLength;
        const cameraDirNormY = cameraDirY / cameraDirLength;
        const cameraDirNormZ = cameraDirZ / cameraDirLength;

        // カメラの上方向
        const cameraUpX = 0;
        const cameraUpY = 1;
        const cameraUpZ = 0;

        // カメラの右方向（外積）
        const cameraRightX = cameraDirNormY * cameraUpZ - cameraDirNormZ * cameraUpY;
        const cameraRightY = cameraDirNormZ * cameraUpX - cameraDirNormX * cameraUpZ;
        const cameraRightZ = cameraDirNormX * cameraUpY - cameraDirNormY * cameraUpX;
        const cameraRightLength = Math.sqrt(cameraRightX * cameraRightX + cameraRightY * cameraRightY + cameraRightZ * cameraRightZ);
        const cameraRightNormX = cameraRightX / cameraRightLength;
        const cameraRightNormY = cameraRightY / cameraRightLength;
        const cameraRightNormZ = cameraRightZ / cameraRightLength;

        // カメラの実際の上方向（外積）
        const cameraActualUpX = cameraRightNormY * cameraDirNormZ - cameraRightNormZ * cameraDirNormY;
        const cameraActualUpY = cameraRightNormZ * cameraDirNormX - cameraRightNormX * cameraDirNormZ;
        const cameraActualUpZ = cameraRightNormX * cameraDirNormY - cameraRightNormY * cameraDirNormX;

        // FOVに基づくスケール
        const fovRad = THREE.MathUtils.degToRad(fov);
        const scale = Math.tan(fovRad / 2);

        // スクリーンの各ピクセルに対して処理
        const step = 1; // 高画質のため1ピクセルごとに処理
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                // スクリーン座標を-1から1の範囲に正規化
                const screenX = (2 * x / width - 1) * aspect * scale;
                const screenY = (1 - 2 * y / height) * scale;

                // レイの方向
                const rayDirX = cameraDirNormX + screenX * cameraRightNormX + screenY * cameraActualUpX;
                const rayDirY = cameraDirNormY + screenX * cameraRightNormY + screenY * cameraActualUpY;
                const rayDirZ = cameraDirNormZ + screenX * cameraRightNormZ + screenY * cameraActualUpZ;

                // レイの方向を正規化
                const rayLength = Math.sqrt(rayDirX * rayDirX + rayDirY * rayDirY + rayDirZ * rayDirZ);
                const rayNormX = rayDirX / rayLength;
                const rayNormY = rayDirY / rayLength;
                const rayNormZ = rayDirZ / rayLength;

                // 球面座標に変換
                const spherePhi = Math.acos(rayNormY);
                const sphereTheta = Math.atan2(rayNormZ, rayNormX);

                // テクスチャ座標に変換
                const u = (sphereTheta + Math.PI) / (2 * Math.PI);
                const v = spherePhi / Math.PI;

                // 画像から色を取得
                const imageX = Math.floor(u * (image.width - 1));
                const imageY = Math.floor(v * (image.height - 1));

                if (imageX >= 0 && imageX < image.width && imageY >= 0 && imageY < image.height) {
                    const pixelIndex = (imageY * image.width + imageX) * 4;
                    const r = pixels[pixelIndex];
                    const g = pixels[pixelIndex + 1];
                    const b = pixels[pixelIndex + 2];
                    const a = pixels[pixelIndex + 3] / 255;

                    // 色を描画
                    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
                    ctx.fillRect(x, y, step, step);
                }
            }
        }

        if (DEBUG_MODE) {
            console.log('Canvas2D mode: Drawing panorama with WebGL-compatible projection');
        }
    }

    // エラーメッセージの表示（警告マークのみ）
    showErrorMessage(message) {
        // 既存のエラーメッセージを削除
        const existingError = this.container.querySelector('.psv-error-message');
        if (existingError) {
            existingError.remove();
        }

        const errorDiv = document.createElement('div');
        errorDiv.className = 'psv-error-message';
        errorDiv.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            width: 30px;
            height: 30px;
            background: rgba(255, 165, 0, 0.9);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: Arial, sans-serif;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            z-index: 1000;
            user-select: none;
            transition: transform 0.2s;
        `;
        errorDiv.textContent = 'i';
        errorDiv.title = 'Canvas2Dモードで動作中 - クリック/タップで詳細表示';

        // ホバー効果
        errorDiv.addEventListener('mouseenter', () => {
            errorDiv.style.transform = 'scale(1.1)';
        });

        errorDiv.addEventListener('mouseleave', () => {
            errorDiv.style.transform = 'scale(1)';
        });

        // クリックで詳細表示
        errorDiv.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showDetailedError(message);
        });

        // タッチイベント対応
        errorDiv.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showDetailedError(message);
        });

        this.container.appendChild(errorDiv);
    }

    // 詳細エラーメッセージの表示
    showDetailedError(message) {
        // 既存の詳細エラーを削除
        const existingDetail = this.container.querySelector('.psv-detailed-error');
        if (existingDetail) {
            existingDetail.remove();
            return; // トグル動作：既に表示されている場合は閉じる
        }

        const detailDiv = document.createElement('div');
        detailDiv.className = 'psv-detailed-error';
        detailDiv.style.cssText = `
            position: absolute;
            top: 50px;
            left: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.95);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            font-size: 13px;
            max-width: 90%;
            width: auto;
            z-index: 1001;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            line-height: 1.5;
            box-sizing: border-box;
        `;

        // 詳細情報を構築
        const detailHTML = `
            <div style="margin-bottom: 10px;">
                <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #FFA500;">
                    お知らせ
                </div>
                <div style="font-size: 12px; color: #fff; line-height: 1.6;">
                    WebGLが使用できないため画質を落として表示しています。<br>
                    高画質で利用するにはハードウェアアクセラレーションを有効にしてください。
                </div>
            </div>
            
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.2);">
                <div style="font-size: 11px; color: #999; text-align: center;">
                    クリック/タップで閉じる
                </div>
            </div>
        `;

        detailDiv.innerHTML = detailHTML;

        // クリックで閉じる
        detailDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            detailDiv.remove();
        });

        // タッチイベントで閉じる
        detailDiv.addEventListener('touchend', (e) => {
            e.stopPropagation();
            detailDiv.remove();
        });

        this.container.appendChild(detailDiv);

        // 10秒後に自動で閉じる
        setTimeout(() => {
            if (detailDiv.parentNode) {
                detailDiv.remove();
            }
        }, 10000);
    }

    // ブラウザ情報を取得
    getBrowserInfo() {
        const ua = navigator.userAgent;
        if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edg') === -1) {
            return 'Chrome';
        } else if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) {
            return 'Safari';
        } else if (ua.indexOf('Firefox') > -1) {
            return 'Firefox';
        } else if (ua.indexOf('Edg') > -1) {
            return 'Edge';
        } else {
            return 'その他';
        }
    }

    // ビューアーのアクティブ化
    activate() {
        if (this.isDisposed) return;

        // アクティブビューアーが多すぎる場合、最も古いものを非アクティブ化
        if (activeViewers.size >= MAX_ACTIVE_VIEWERS) {
            const oldestViewer = Array.from(activeViewers)[0];
            oldestViewer.deactivate();
        }

        activeViewers.add(this);
        this.startAnimation();
    }

    // ビューアーの非アクティブ化
    deactivate() {
        if (this.isDisposed) return;

        activeViewers.delete(this);
        this.stopAnimation();
    }

    // アニメーションの開始
    startAnimation() {
        if (!this.isAnimating) {
            this.isAnimating = true;
            this.animate();
        }
    }

    // アニメーションの停止
    stopAnimation() {
        this.isAnimating = false;
    }

    // リソースの解放
    dispose() {
        if (this.isDisposed) return;

        this.isDisposed = true;
        this.deactivate();
        this.observer.disconnect();

        // Intersection Observerのクリーンアップ
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        // autoRotateTimeoutのクリーンアップ
        if (this.autoRotateTimeout) {
            clearTimeout(this.autoRotateTimeout);
            this.autoRotateTimeout = null;
        }

        // Three.jsのリソース解放
        if (this.sphere) {
            this.sphere.geometry.dispose();
            this.sphere.material.map?.dispose();
            this.sphere.material.dispose();
            this.scene.remove(this.sphere);
        }

        if (this.scene) {
            this.scene.clear();
        }

        if (this.renderer) {
            // WebGLコンテキストイベントリスナーの削除
            if (!this.renderer.isCanvas2D) {
                this.renderer.domElement.removeEventListener('webglcontextlost', this.boundHandleContextLost);
                this.renderer.domElement.removeEventListener('webglcontextrestored', this.boundHandleContextRestored);
            }

            if (this.renderer.isCanvas2D) {
                // Canvas2Dレンダラーのクリーンアップ
                this.renderer.dispose();
            } else {
                // WebGLレンダラーのクリーンアップ
                this.renderer.dispose();
            }

            if (this.container.contains(this.renderer.domElement)) {
                this.container.removeChild(this.renderer.domElement);
            }
        }

        // イベントリスナーの削除
        this.removeEventListeners();

        // ボタンの削除
        if (this.zoomInButton && this.zoomInButton.parentNode) {
            this.zoomInButton.parentNode.removeChild(this.zoomInButton);
        }
        if (this.zoomOutButton && this.zoomOutButton.parentNode) {
            this.zoomOutButton.parentNode.removeChild(this.zoomOutButton);
        }
        if (this.fullscreenButton && this.fullscreenButton.parentNode) {
            this.fullscreenButton.parentNode.removeChild(this.fullscreenButton);
        }

        // DOM要素の削除
        if (this.controlsContainer && this.container.contains(this.controlsContainer)) {
            this.container.removeChild(this.controlsContainer);
        }

        // 参照の解放
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.sphere = null;
        this.controlsContainer = null;
        this.zoomInButton = null;
        this.zoomOutButton = null;
        this.fullscreenButton = null;
    }

    // イベントリスナーの設定
    setupEventListeners() {
        // フルスクリーンボタンの追加（常に表示）
        // if (!this.isMobile) { // モバイル判定を無視して表示
        this.fullscreenButton = document.createElement('button');
        this.fullscreenButton.className = 'psv-btn psv-fullscreen-btn';
        this.fullscreenButton.title = 'フルスクリーン';
        this.fullscreenButton.innerHTML = '⛶'; // フルスクリーン開始アイコン

        // クリックイベント
        this.boundFullscreenClick = (e) => {
            e.stopPropagation();
            if (DEBUG_MODE) {
                console.log('フルスクリーンボタン onclick');
            }
            this.toggleFullscreen();
        };
        this.fullscreenButton.onclick = this.boundFullscreenClick;

        this.container.appendChild(this.fullscreenButton);
        // }

        // ズームインボタンの追加（左下）
        this.zoomInButton = document.createElement('button');
        this.zoomInButton.className = 'psv-btn psv-zoom-btn psv-zoom-in-btn';
        this.zoomInButton.title = 'ズームイン';
        this.zoomInButton.innerHTML = '+';

        this.boundZoomInClick = (e) => {
            e.stopPropagation();
            this.zoomIn();
        };
        this.zoomInButton.onclick = this.boundZoomInClick;

        // スマホ用タッチイベント
        this.boundZoomInTouch = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.zoomIn();
        };
        this.zoomInButton.addEventListener('touchend', this.boundZoomInTouch, { passive: false });
        this.container.appendChild(this.zoomInButton);

        // ズームアウトボタンの追加（左下）
        this.zoomOutButton = document.createElement('button');
        this.zoomOutButton.className = 'psv-btn psv-zoom-btn psv-zoom-out-btn';
        this.zoomOutButton.title = 'ズームアウト';
        this.zoomOutButton.innerHTML = '−';

        this.boundZoomOutClick = (e) => {
            e.stopPropagation();
            this.zoomOut();
        };
        this.zoomOutButton.onclick = this.boundZoomOutClick;

        // スマホ用タッチイベント
        this.boundZoomOutTouch = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.zoomOut();
        };
        this.zoomOutButton.addEventListener('touchend', this.boundZoomOutTouch, { passive: false });
        this.container.appendChild(this.zoomOutButton);

        // イベントリスナーの設定（バインド済みメソッドを使用）
        this.container.addEventListener('mousedown', this.boundOnDocumentMouseDown, false);
        this.container.addEventListener('mousemove', this.boundOnDocumentMouseMove, false);
        this.container.addEventListener('mouseup', this.boundOnDocumentMouseUp, false);
        this.container.addEventListener('mouseleave', this.boundOnDocumentMouseUp, false);
        this.container.addEventListener('touchstart', this.boundOnDocumentTouchStart, false);
        this.container.addEventListener('touchmove', this.boundOnDocumentTouchMove, false);
        this.container.addEventListener('touchend', this.boundOnDocumentTouchEnd, false);

        // クリックイベントをキャンセル（ズーム防止）
        this.container.addEventListener('click', this.boundOnContainerClick, false);

        // カーソル初期設定
        this.updateCursor();

        // リサイズイベントの設定
        window.addEventListener('resize', this.boundOnWindowResize, false);

        // フルスクリーン状態変更の監視
        // if (!this.isMobile) {
        document.addEventListener('fullscreenchange', this.boundHandleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.boundHandleFullscreenChange);
        document.addEventListener('mozfullscreenchange', this.boundHandleFullscreenChange);
        document.addEventListener('MSFullscreenChange', this.boundHandleFullscreenChange);

        // ESCキーで終了
        document.addEventListener('keydown', this.boundHandleEscapeKey);
        // }

        // ページ遷移時のクリーンアップ
        window.addEventListener('beforeunload', this.boundHandleBeforeUnload);
    }

    // コンテナクリックハンドラー
    onContainerClick(e) {
        // ボタン以外のクリックをキャンセル
        if (e.target !== this.zoomInButton &&
            e.target !== this.zoomOutButton &&
            (!this.isMobile && e.target !== this.fullscreenButton)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    // イベントリスナーの削除
    removeEventListeners() {
        // コンテナのイベントリスナーを削除（バインド済みメソッドを使用）
        if (this.container) {
            this.container.removeEventListener('mousedown', this.boundOnDocumentMouseDown);
            this.container.removeEventListener('mousemove', this.boundOnDocumentMouseMove);
            this.container.removeEventListener('mouseup', this.boundOnDocumentMouseUp);
            this.container.removeEventListener('mouseleave', this.boundOnDocumentMouseUp);
            this.container.removeEventListener('touchstart', this.boundOnDocumentTouchStart);
            this.container.removeEventListener('touchmove', this.boundOnDocumentTouchMove);
            this.container.removeEventListener('touchend', this.boundOnDocumentTouchEnd);
            this.container.removeEventListener('click', this.boundOnContainerClick);
        }

        // ボタンのイベントリスナーを削除
        if (this.zoomInButton) {
            if (this.boundZoomInClick) {
                this.zoomInButton.onclick = null;
            }
            if (this.boundZoomInTouch) {
                this.zoomInButton.removeEventListener('touchend', this.boundZoomInTouch);
            }
        }

        if (this.zoomOutButton) {
            if (this.boundZoomOutClick) {
                this.zoomOutButton.onclick = null;
            }
            if (this.boundZoomOutTouch) {
                this.zoomOutButton.removeEventListener('touchend', this.boundZoomOutTouch);
            }
        }

        if (this.fullscreenButton) {
            if (this.boundFullscreenClick) {
                this.fullscreenButton.onclick = null;
            }
        }

        // ウィンドウのイベントリスナーを削除
        window.removeEventListener('resize', this.boundOnWindowResize);
        window.removeEventListener('beforeunload', this.boundHandleBeforeUnload);

        // フルスクリーン関連のイベントリスナーを削除
        if (!this.isMobile) {
            document.removeEventListener('fullscreenchange', this.boundHandleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', this.boundHandleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', this.boundHandleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', this.boundHandleFullscreenChange);
            document.removeEventListener('keydown', this.boundHandleEscapeKey);
        }

        // preventScrollのクリーンアップ
        document.removeEventListener('touchmove', this.boundPreventScroll);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer || this.isDisposed) return;

        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    onDocumentMouseDown(event) {
        // ズームボタンやフルスクリーンボタン、エラーメッセージのクリックは処理しない
        if (event.target === this.zoomInButton ||
            event.target === this.zoomOutButton ||
            (!this.isMobile && event.target === this.fullscreenButton) ||
            event.target.classList.contains('psv-error-message') ||
            event.target.classList.contains('psv-detailed-error') ||
            event.target.closest('.psv-error-message') ||
            event.target.closest('.psv-detailed-error')) {
            return;
        }

        event.preventDefault();
        this.isUserInteracting = true;
        this.onMouseDownMouseX = event.clientX;
        this.onMouseDownMouseY = event.clientY;
        this.onMouseDownLon = this.lon;
        this.onMouseDownLat = this.lat;
        this.stopAutoRotate();
        this.updateCursor();
    }

    onDocumentMouseMove(event) {
        if (this.isUserInteracting) {
            this.lon = (this.onMouseDownMouseX - event.clientX) * 0.1 + this.onMouseDownLon;
            // 縦方向を反転：下にドラッグ = 上を見る（Googleストリートビューと同じ）
            this.lat = (this.onMouseDownMouseY - event.clientY) * 0.1 + this.onMouseDownLat;
        }
        this.updateCursor();
    }

    onDocumentMouseUp() {
        if (this.isUserInteracting) {
            this.isUserInteracting = false;
            this.restartAutoRotateWithDelay();
            this.updateCursor();
        }
    }

    onDocumentTouchStart(event) {
        // ボタンエリアでのタッチイベントは無視する
        if (this.isButtonTouch(event.target)) {
            return;
        }

        if (DEBUG_MODE) {
            console.log('Touch start:', {
                touches: event.touches.length,
                target: event.target.className,
                isMobile: this.isMobile
            });
        }

        if (event.touches.length === 1) {
            event.preventDefault();
            this.onMouseDownMouseX = event.touches[0].pageX;
            this.onMouseDownMouseY = event.touches[0].pageY;
            this.onMouseDownLon = this.lon;
            this.onMouseDownLat = this.lat;
            this.isUserInteracting = true;
            this.stopAutoRotate();
            this.updateCursor();
        }
    }

    onDocumentTouchMove(event) {
        // ボタンエリアでのタッチイベントは無視する
        if (this.isButtonTouch(event.target)) {
            return;
        }

        if (event.touches.length === 1 && this.isUserInteracting) {
            event.preventDefault();
            this.lon = (this.onMouseDownMouseX - event.touches[0].pageX) * 0.15 + this.onMouseDownLon;
            // 縦方向を反転：下にドラッグ = 上を見る（Googleストリートビューと同じ）
            this.lat = (this.onMouseDownMouseY - event.touches[0].pageY) * 0.15 + this.onMouseDownLat;
        }
        this.updateCursor();
    }

    onDocumentTouchEnd(event) {
        // ボタンエリアでのタッチイベントは無視する
        if (this.isButtonTouch(event.target)) {
            return;
        }

        if (this.isUserInteracting) {
            this.isUserInteracting = false;
            this.restartAutoRotateWithDelay();
            this.updateCursor();
        }
    }

    stopAutoRotate() {
        this.autoRotate = false;
        if (this.autoRotateTimeout) {
            clearTimeout(this.autoRotateTimeout);
            this.autoRotateTimeout = null;
        }
        // 自動回転停止時に時間をリセット
        this.lastTime = 0;
    }

    restartAutoRotateWithDelay() {
        if (this.autoRotateTimeout) {
            clearTimeout(this.autoRotateTimeout);
        }
        this.autoRotateTimeout = setTimeout(() => {
            this.autoRotate = true;
            // 自動回転再開時に時間をリセット
            this.lastTime = 0;
        }, 3000);
    }

    updateCursor() {
        if (!this.container) return;

        if (this.isUserInteracting) {
            this.container.style.cursor = 'grabbing';
        } else {
            this.container.style.cursor = 'move';
        }
    }

    toggleFullscreen() {
        // モバイルデバイスではフルスクリーン機能を無効化 - 無効化解除
        // if (this.isMobile) {
        //     return;
        // }

        if (DEBUG_MODE) {
            console.log('フルスクリーンボタンがクリックされました');
        }

        if (!this.isFullscreen) {
            this.enterFullscreen();
        } else {
            this.exitFullscreen();
        }
    }

    enterFullscreen() {
        // モバイルデバイスではフルスクリーン機能を無効化 - 無効化解除
        // if (this.isMobile) {
        //     return;
        // }

        if (DEBUG_MODE) {
            console.log('フルスクリーン開始');
        }

        // 画面回転を横向きに固定（対応ブラウザのみ）
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(err => {
                if (DEBUG_MODE) {
                    console.log('画面回転ロックに失敗:', err);
                }
            });
        }

        // 元の状態を保存
        this.originalParent = this.container.parentNode;
        this.originalNextSibling = this.container.nextSibling;
        this.originalPosition = this.container.style.position;
        this.originalTop = this.container.style.top;
        this.originalLeft = this.container.style.left;
        this.originalWidth = this.container.style.width;
        this.originalHeight = this.container.style.height;
        this.originalZIndex = this.container.style.zIndex;
        this.originalBackground = this.container.style.backgroundColor;

        // フルスクリーンオーバーレイを作成
        this.fullscreenOverlay = document.createElement('div');
        this.fullscreenOverlay.className = 'psv-fullscreen-overlay';
        this.fullscreenOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #000;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // ビューアーをフルスクリーンスタイルに
        this.container.style.position = 'relative';
        this.container.style.width = '100vw';
        this.container.style.height = '100vh';
        this.container.style.paddingTop = '0';
        this.container.style.maxWidth = 'none';
        this.container.style.maxHeight = 'none';
        this.container.style.backgroundColor = '#000';

        // オーバーレイにビューアーを移動
        this.fullscreenOverlay.appendChild(this.container);
        document.body.appendChild(this.fullscreenOverlay);

        // 真のフルスクリーンを試行
        this.tryTrueFullscreen();

        this.isFullscreen = true;
        this.onFullscreenChange();

        // スクロール防止
        document.body.style.overflow = 'hidden';

        // フルスクリーン時のみタッチスクロール防止（iOS対応）
        document.addEventListener('touchmove', this.boundPreventScroll, { passive: false });
    }

    tryTrueFullscreen() {
        // Mac対応のフルスクリーン実装
        const docElement = document.documentElement;

        // MacのSafari/Chrome対応
        if (this.isMac) {
            // Macではより確実なフルスクリーン実装
            if (docElement.webkitRequestFullscreen) {
                docElement.webkitRequestFullscreen().catch(err => {
                    if (DEBUG_MODE) {
                        console.log('Mac webkitRequestFullscreen 失敗:', err);
                    }
                    this.tryAlternativeFullscreen();
                });
            } else if (docElement.requestFullscreen) {
                docElement.requestFullscreen().catch(err => {
                    if (DEBUG_MODE) {
                        console.log('Mac requestFullscreen 失敗:', err);
                    }
                    this.tryAlternativeFullscreen();
                });
            } else {
                if (DEBUG_MODE) {
                    console.log('MacでフルスクリーンAPIが対応していません');
                }
                this.tryAlternativeFullscreen();
            }
        } else {
            // 他のOSでの従来の実装
            if (docElement.requestFullscreen) {
                docElement.requestFullscreen().catch(err => {
                    if (DEBUG_MODE) {
                        console.log('documentElement.requestFullscreen 失敗:', err);
                    }
                    this.tryAlternativeFullscreen();
                });
            } else if (docElement.webkitRequestFullscreen) {
                docElement.webkitRequestFullscreen();
            } else if (docElement.mozRequestFullScreen) {
                docElement.mozRequestFullScreen();
            } else if (docElement.msRequestFullscreen) {
                docElement.msRequestFullscreen();
            } else {
                if (DEBUG_MODE) {
                    console.log('フルスクリーンAPIが対応していません');
                }
                this.tryAlternativeFullscreen();
            }
        }
    }

    tryAlternativeFullscreen() {
        // モバイルブラウザでの代替フルスクリーン
        if (DEBUG_MODE) {
            console.log('代替フルスクリーンモード');
        }

        // ビューポートの制御
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            this.originalViewport = viewport.getAttribute('content');
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }

        // iOS Safari の場合のアドレスバー非表示
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            setTimeout(() => {
                window.scrollTo(0, 1);
            }, 100);
        }
    }

    preventScroll(e) {
        e.preventDefault();
        return false;
    }

    exitFullscreen() {
        if (DEBUG_MODE) {
            console.log('フルスクリーン終了');
        }

        // 画面回転ロックを解除
        if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
        }

        // ビューポートを元に戻す
        if (this.originalViewport) {
            const viewport = document.querySelector('meta[name="viewport"]');
            if (viewport) {
                viewport.setAttribute('content', this.originalViewport);
            }
        }

        // スクロール防止を解除
        document.body.style.overflow = '';
        document.removeEventListener('touchmove', this.boundPreventScroll);

        // ビューアーを元の位置に戻す
        if (this.originalParent) {
            this.container.style.position = this.originalPosition;
            this.container.style.top = this.originalTop;
            this.container.style.left = this.originalLeft;
            this.container.style.width = this.originalWidth;
            this.container.style.height = this.originalHeight;
            this.container.style.zIndex = this.originalZIndex;
            this.container.style.backgroundColor = this.originalBackground;
            this.container.style.paddingTop = '56.25%'; // 元の16:9比率に戻す
            this.container.style.maxWidth = '';
            this.container.style.maxHeight = '';

            // 元の親要素に戻す
            if (this.originalNextSibling) {
                this.originalParent.insertBefore(this.container, this.originalNextSibling);
            } else {
                this.originalParent.appendChild(this.container);
            }
        }

        // オーバーレイを削除
        if (this.fullscreenOverlay) {
            this.fullscreenOverlay.remove();
            this.fullscreenOverlay = null;
        }

        // Mac対応のフルスクリーン終了
        if (this.isMac) {
            // Macではより確実なフルスクリーン終了
            if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => {
                    if (DEBUG_MODE) {
                        console.log('Mac フルスクリーン終了失敗:', err);
                    }
                });
            }
        } else {
            // 他のOSでの従来の実装
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => {
                    if (DEBUG_MODE) {
                        console.log('フルスクリーン終了失敗:', err);
                    }
                });
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }

        this.isFullscreen = false;
        this.onFullscreenChange();

        // リサイズイベントを発火して描画を更新
        setTimeout(() => {
            this.onWindowResize();
        }, 100);
    }

    onFullscreenChange() {
        // フルスクリーン状態変更時の処理
        this.onWindowResize();

        // ボタンテキストを更新（PC および Mac）
        if (!this.isMobile && this.fullscreenButton) {
            if (this.isFullscreen) {
                // フルスクリーン終了アイコン
                this.fullscreenButton.innerHTML = '✕'; // ×マーク（終了）
                this.fullscreenButton.title = 'フルスクリーン終了';
            } else {
                // フルスクリーン開始アイコン
                this.fullscreenButton.innerHTML = '⛶'; // フルスクリーン開始アイコン
                this.fullscreenButton.title = 'フルスクリーン';
            }
        }
    }

    animate() {
        if (!this.isAnimating || this.isDisposed) return;

        requestAnimationFrame(this.animate.bind(this));
        this.update();
    }

    update() {
        if (!this.camera || !this.renderer || this.isDisposed || !this.isVisible) return;

        // 時間ベースの自動回転（フレームレート非依存）
        if (this.autoRotate && !this.isUserInteracting) {
            const currentTime = performance.now();
            if (this.lastTime > 0) {
                const deltaTime = (currentTime - this.lastTime) / 1000; // 秒に変換
                this.lon += this.autoRotateSpeed * deltaTime; // 時間に比例した回転
            }
            this.lastTime = currentTime;
        } else {
            // 自動回転が停止している間は時間をリセット
            this.lastTime = performance.now();
        }

        this.lat = Math.max(-85, Math.min(85, this.lat));
        this.phi = THREE.MathUtils.degToRad(90 - this.lat);
        this.theta = THREE.MathUtils.degToRad(this.lon);

        // Canvas2DモードとWebGLモードで処理を分ける
        if (this.renderer.isCanvas2D) {
            // Canvas2Dモードでは直接描画処理を呼び出す
            this.renderCanvas2D(this.scene, this.camera);
        } else {
            // WebGLモードでは通常の処理
            this.camera.position.x = 100 * Math.sin(this.phi) * Math.cos(this.theta);
            this.camera.position.y = 100 * Math.cos(this.phi);
            this.camera.position.z = 100 * Math.sin(this.phi) * Math.sin(this.theta);

            this.camera.lookAt(this.camera.target);
            this.renderer.render(this.scene, this.camera);
        }
    }

    zoomIn() {
        if (!this.camera || this.isDisposed) return;
        this.camera.fov = Math.max(30, this.camera.fov - 10);
        this.camera.updateProjectionMatrix();

        // Canvas2Dモードの場合は手動で再描画
        if (this.renderer && this.renderer.isCanvas2D) {
            this.renderCanvas2D(this.scene, this.camera);
        }
    }

    zoomOut() {
        if (!this.camera || this.isDisposed) return;
        this.camera.fov = Math.min(90, this.camera.fov + 10);
        this.camera.updateProjectionMatrix();

        // Canvas2Dモードの場合は手動で再描画
        if (this.renderer && this.renderer.isCanvas2D) {
            this.renderCanvas2D(this.scene, this.camera);
        }
    }

    // ボタンタッチかどうかを判定するヘルパーメソッド
    isButtonTouch(target) {
        return target === this.zoomInButton ||
            target === this.zoomOutButton ||
            (!this.isMobile && target === this.fullscreenButton) ||
            target.closest('.psv-btn') || // ボタンの子要素も考慮
            target.classList.contains('psv-error-message') ||
            target.classList.contains('psv-detailed-error') ||
            target.closest('.psv-error-message') ||
            target.closest('.psv-detailed-error'); // エラーメッセージも無視
    }

    handleFullscreenChange() {
        // モバイルデバイスではフルスクリーン機能を無効化
        if (this.isMobile) {
            return;
        }

        // ブラウザのフルスクリーン状態をチェック
        const isCurrentlyFullscreen = !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );

        this.isFullscreen = isCurrentlyFullscreen;
        this.onFullscreenChange();
    }

    handleEscapeKey(e) {
        // モバイルデバイスではフルスクリーン機能を無効化
        if (this.isMobile) {
            return;
        }

        if (e.key === 'Escape' && this.isFullscreen) {
            this.exitFullscreen();
        }
    }
}

// ビューアーの初期化
document.addEventListener('DOMContentLoaded', function () {
    const containers = document.querySelectorAll('.psv-container');
    const viewers = new Map();

    containers.forEach(container => {
        const imageUrl = container.getAttribute('data-img');
        if (imageUrl) {
            const viewer = new PanoramaViewer(container, imageUrl);
            viewers.set(container, viewer);
        }
    });

    // ページ遷移時のクリーンアップ
    window.addEventListener('beforeunload', () => {
        viewers.forEach(viewer => viewer.dispose());
        viewers.clear();
    });
}); 
