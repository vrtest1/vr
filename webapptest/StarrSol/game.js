class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = 800;
        this.canvas.height = 600;
        
        // オーディオコンテキストの初期化
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 背景の星を3レイヤーで生成（遠い、中間、近い）
        this.starLayers = [
            // 遠い星（小さくてゆっくり）
            Array.from({ length: 50 }, () => ({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: 1,
                speed: 0.5,
                brightness: 0.5
            })),
            // 中間の星（中くらい）
            Array.from({ length: 30 }, () => ({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: 1.5,
                speed: 1,
                brightness: 0.7
            })),
            // 近い星（大きくて速い）
            Array.from({ length: 20 }, () => ({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: 2,
                speed: 1.5,
                brightness: 1
            }))
        ];
        
        // スタート画面の要素
        this.startScreen = document.getElementById('startScreen');
        this.startButton = document.getElementById('startButton');
        
        // ゲームの状態
        this.isGameStarted = false;
        
        // 敵のドット絵データ（16x16ピクセル）
        this.enemySprite = [
            [0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
            [0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0],
            [0,0,1,1,1,2,1,1,1,1,2,1,1,1,0,0],
            [0,1,1,1,1,2,1,1,1,1,2,1,1,1,1,0],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
            [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
            [0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0],
            [0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0],
            [0,0,0,0,0,1,1,1,1,1,1,1,0,0,0,0],
            [0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0]
        ];
        
        // 敵の配列
        this.enemies = [];
        this.lastEnemySpawn = 0;
        this.enemySpawnInterval = 2000; // 2秒ごとに敵を生成
        
        // プレイヤーのドット絵データ（20x20ピクセル）
        // 0: 透明, 1: 機体（グレー）, 2: 窓ガラス（青）
        this.playerSprite = [
            [0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0],
            [0,0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0],
            [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
            [0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
            [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
            [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
            [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
            [0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
            [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
            [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
            [0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0,0,0,0],
            [0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0]
        ];
        
        // 窓ガラスの位置データ
        this.windowPositions = [
            {x: 8, y: 6}, {x: 9, y: 6}, {x: 10, y: 6}, {x: 11, y: 6},
            {x: 7, y: 7}, {x: 8, y: 7}, {x: 9, y: 7}, {x: 10, y: 7}, {x: 11, y: 7}, {x: 12, y: 7},
            {x: 6, y: 8}, {x: 7, y: 8}, {x: 8, y: 8}, {x: 9, y: 8}, {x: 10, y: 8}, {x: 11, y: 8}, {x: 12, y: 8}, {x: 13, y: 8}
        ];
        
        this.player = {
            x: this.canvas.width / 2 - 10,
            y: this.canvas.height - 60,
            width: 20,
            height: 20,
            speed: 5
        };
        
        this.bullets = [];
        this.lastBulletTime = 0;
        this.bulletInterval = 200; // ミリ秒
        
        this.keys = {};
        this.touchX = null;
        this.touchY = null;
        
        // BGMの初期化を遅延させる
        this.initializeAudio();
        this.setupEventListeners();

        // 爆発エフェクトのドット絵データ（アニメーションフレーム）
        this.explosionSprites = [
            [ // フレーム1
                [0,0,1,1,1,1,0,0],
                [0,1,1,1,1,1,1,0],
                [1,1,2,2,2,2,1,1],
                [1,1,2,2,2,2,1,1],
                [1,1,2,2,2,2,1,1],
                [1,1,2,2,2,2,1,1],
                [0,1,1,1,1,1,1,0],
                [0,0,1,1,1,1,0,0]
            ],
            [ // フレーム2
                [0,1,1,0,0,1,1,0],
                [1,1,2,1,1,2,1,1],
                [1,2,2,2,2,2,2,1],
                [0,1,2,2,2,2,1,0],
                [0,1,2,2,2,2,1,0],
                [1,2,2,2,2,2,2,1],
                [1,1,2,1,1,2,1,1],
                [0,1,1,0,0,1,1,0]
            ],
            [ // フレーム3
                [1,0,0,1,1,0,0,1],
                [0,1,1,2,2,1,1,0],
                [0,1,2,2,2,2,1,0],
                [1,2,2,1,1,2,2,1],
                [1,2,2,1,1,2,2,1],
                [0,1,2,2,2,2,1,0],
                [0,1,1,2,2,1,1,0],
                [1,0,0,1,1,0,0,1]
            ]
        ];

        // 爆発エフェクトの配列
        this.explosions = [];

        // 大きな爆発エフェクトのドット絵データ（プレイヤー用）
        this.largeExplosionSprites = [
            [ // フレーム1
                [0,0,0,1,1,1,1,1,1,1,1,0,0,0],
                [0,0,1,1,1,1,1,1,1,1,1,1,0,0],
                [0,1,1,2,2,2,1,1,2,2,2,1,1,0],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [0,1,1,2,2,2,1,1,2,2,2,1,1,0],
                [0,0,1,1,1,1,1,1,1,1,1,1,0,0],
                [0,0,0,1,1,1,1,1,1,1,1,0,0,0]
            ],
            [ // フレーム2
                [0,0,1,0,0,1,1,1,1,0,0,1,0,0],
                [0,1,1,1,1,2,1,1,2,1,1,1,1,0],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [0,1,2,2,2,2,2,2,2,2,2,2,1,0],
                [0,1,2,2,2,2,2,2,2,2,2,2,1,0],
                [1,2,2,2,2,2,2,2,2,2,2,2,2,1],
                [1,2,2,2,2,2,2,2,2,2,2,2,2,1],
                [0,1,2,2,2,2,2,2,2,2,2,2,1,0],
                [0,1,2,2,2,2,2,2,2,2,2,2,1,0],
                [1,1,2,2,2,2,2,2,2,2,2,2,1,1],
                [0,1,1,1,1,2,1,1,2,1,1,1,1,0],
                [0,0,1,0,0,1,1,1,1,0,0,1,0,0]
            ],
            [ // フレーム3
                [1,0,0,0,1,0,0,0,0,1,0,0,0,1],
                [0,1,0,1,1,1,0,0,1,1,1,0,1,0],
                [0,0,1,2,2,2,1,1,2,2,2,1,0,0],
                [0,1,2,2,2,2,2,2,2,2,2,2,1,0],
                [1,1,2,2,1,1,2,2,1,1,2,2,1,1],
                [0,1,2,2,1,1,2,2,1,1,2,2,1,0],
                [0,1,2,2,1,1,2,2,1,1,2,2,1,0],
                [1,1,2,2,1,1,2,2,1,1,2,2,1,1],
                [0,1,2,2,2,2,2,2,2,2,2,2,1,0],
                [0,0,1,2,2,2,1,1,2,2,2,1,0,0],
                [0,1,0,1,1,1,0,0,1,1,1,0,1,0],
                [1,0,0,0,1,0,0,0,0,1,0,0,0,1]
            ]
        ];

        this.score = 0; // スコアの初期化
        this.isGameOver = false;
        this.playerExplosion = null;
        this.animationFrameId = null; // アニメーションフレームIDを追加

        // 建物の背景データを追加
        this.buildings = [
            // 大きな鉄骨構造の塔
            {
                x: 50,
                y: -400,
                width: 80,
                height: 400,
                color: '#FF6B47',
                pattern: [
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [0,0,1,0,0,1,0,0,1,0,0],
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [0,0,1,0,0,1,0,0,1,0,0],
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [0,0,1,0,0,1,0,0,1,0,0],
                    [1,1,0,1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1,0,1,1]
                ],
                speed: 1.0
            },
            {
                x: 300,
                y: -350,
                width: 60,
                height: 350,
                color: '#FF6B47',
                pattern: [
                    [1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1],
                    [0,0,1,0,0,1,0,0],
                    [1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1],
                    [0,0,1,0,0,1,0,0],
                    [1,1,0,1,1,0,1,1],
                    [1,1,0,1,1,0,1,1]
                ],
                speed: 1.0
            },
            // 大きなレンガ造りの建物
            {
                x: 180,
                y: -300,
                width: 100,
                height: 300,
                color: '#FF4500',
                pattern: [
                    [1,1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,1,0,1,0,1],
                    [1,1,1,1,1,1,1,1,1,1],
                    [1,1,0,0,1,1,0,0,1,1],
                    [1,1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,1,0,1,0,1],
                    [1,1,1,1,1,1,1,1,1,1],
                    [1,1,0,0,1,1,0,0,1,1],
                    [1,1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,1,0,1,0,1]
                ],
                speed: 0.7
            },
            {
                x: 450,
                y: -280,
                width: 90,
                height: 280,
                color: '#FF4500',
                pattern: [
                    [1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,0,1,0,1],
                    [1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,0,1,0,1],
                    [1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,0,1,0,1],
                    [1,1,1,1,1,1,1,1,1],
                    [1,0,1,0,1,0,1,0,1],
                    [1,1,1,1,1,1,1,1,1]
                ],
                speed: 0.7
            }
        ];

        // 敵の編隊パターンを定義
        this.formationPatterns = [
            // Vの字隊形
            {
                positions: [
                    {x: 0, y: 0},
                    {x: -40, y: 30},
                    {x: 40, y: 30},
                    {x: -80, y: 60},
                    {x: 80, y: 60}
                ],
                interval: 4000,
                minScore: 0
            },
            // 横一列隊形
            {
                positions: [
                    {x: -80, y: 0},
                    {x: -40, y: 0},
                    {x: 0, y: 0},
                    {x: 40, y: 0},
                    {x: 80, y: 0}
                ],
                interval: 5000,
                minScore: 5
            },
            // 菱形隊形
            {
                positions: [
                    {x: 0, y: 0},
                    {x: -40, y: 40},
                    {x: 40, y: 40},
                    {x: 0, y: 80},
                    {x: -80, y: 40},
                    {x: 80, y: 40}
                ],
                interval: 6000,
                minScore: 10
            }
        ];

        this.lastFormationTime = 0;
        this.currentFormationInterval = 4000;

        // 建物の初期配置
        this.initializeBuildings();

        this.touchOffset = 100; // タップ位置から上方向へのオフセット
    }
    
    initializeAudio() {
        // BGMの設定
        this.bgm = document.getElementById('bgm');
        if (this.bgm) {
            this.bgm.volume = 0.5;
        } else {
            console.warn('BGM要素が見つかりません');
        }
    }
    
    setupEventListeners() {
        // スタートボタンのイベントリスナー
        this.startButton.addEventListener('click', () => {
            this.startGame();
        });
        
        // キーボード操作
        window.addEventListener('keydown', (e) => {
            if (this.isGameStarted) {
                this.keys[e.key] = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            if (this.isGameStarted) {
                this.keys[e.key] = false;
            }
        });
        
        // タッチ操作
        this.canvas.addEventListener('touchstart', (e) => {
            if (this.isGameStarted) {
                e.preventDefault();
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();
                this.touchX = touch.clientX - rect.left;
                this.touchY = touch.clientY - rect.top;
            }
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            if (this.isGameStarted) {
                e.preventDefault();
                const touch = e.touches[0];
                const rect = this.canvas.getBoundingClientRect();
                this.touchX = touch.clientX - rect.left;
                this.touchY = touch.clientY - rect.top;
            }
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            if (this.isGameStarted) {
                e.preventDefault();
                // タッチ位置をnullに設定する前に、最後の位置を保持
                const lastTouchX = this.touchX;
                const lastTouchY = this.touchY - this.touchOffset;
                
                // 現在位置が画面内なら、その位置で停止
                if (lastTouchY >= 0 && lastTouchY <= this.canvas.height - this.player.height) {
                    this.player.x = lastTouchX;
                    this.player.y = lastTouchY;
                }
                
                this.touchX = null;
                this.touchY = null;
            }
        });
    }
    
    startGame() {
        // 既存のアニメーションフレームをキャンセル
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.isGameStarted = true;
        this.startScreen.style.display = 'none';
        this.isGameOver = false;
        this.playerExplosion = null;
        this.enemies = [];
        this.bullets = [];
        this.score = 0;
        this.player.x = this.canvas.width / 2 - 10;
        this.player.y = this.canvas.height - 60;
        
        // オーディオコンテキストの開始
        this.audioCtx.resume();
        
        // BGMの再生開始
        if (this.bgm) {
            this.bgm.currentTime = 0;
            this.bgm.play().catch(error => {
                console.log('BGMの再生に失敗しました:', error);
            });
        }
        
        // 建物の位置をリセット
        this.buildings.forEach((building, index) => {
            const baseY = -(index % 2 === 0 ? 400 : 300);
            building.y = baseY - (Math.floor(index / 2) * 200);
        });
        
        this.lastFormationTime = 0;
        this.currentFormationInterval = 4000;
        
        // ゲームループの開始
        this.gameLoop();
    }
    
    update() {
        if (!this.isGameStarted || this.isGameOver) return;
        
        // 星のアニメーション
        this.starLayers.forEach(layer => {
            layer.forEach(star => {
                star.y += star.speed;
                if (star.y > this.canvas.height) {
                    star.y = 0;
                    star.x = Math.random() * this.canvas.width;
                }
            });
        });
        
        // 建物のスクロール
        this.buildings.forEach(building => {
            building.y += building.speed;
            // 画面外に出た建物を上部に戻す
            if (building.y > this.canvas.height) {
                building.y = -building.height;
            }
        });
        
        // 敵との衝突判定
        this.enemies.forEach(enemy => {
            if (this.checkCollision(this.player, enemy) && !this.isGameOver) {
                this.isGameOver = true;
                
                // まずBGMを停止
                if (this.bgm) {
                    this.bgm.pause();
                    this.bgm.currentTime = 0;
                }

                // 爆発エフェクトと音を追加
                this.addPlayerExplosion();
                this.playPlayerExplosionSound();
                
                // 爆発音の再生が終わってからリスタートボタンを表示
                setTimeout(() => {
                    this.showRestartButton();
                }, 1500); // 1.5秒後に表示
            }
        });

        // プレイヤーの爆発アニメーション更新
        if (this.playerExplosion) {
            this.playerExplosion.frameTime++;
            if (this.playerExplosion.frameTime > 8) {
                this.playerExplosion.frame++;
                this.playerExplosion.frameTime = 0;
            }
        }

        // ゲームオーバーでない場合のみ更新
        if (!this.isGameOver) {
            // プレイヤーの移動
            if (this.keys['w'] || this.keys['W'] || this.keys['ArrowUp']) this.player.y -= this.player.speed;
            if (this.keys['s'] || this.keys['S'] || this.keys['ArrowDown']) this.player.y += this.player.speed;
            if (this.keys['a'] || this.keys['A'] || this.keys['ArrowLeft']) this.player.x -= this.player.speed;
            if (this.keys['d'] || this.keys['D'] || this.keys['ArrowRight']) this.player.x += this.player.speed;
            
            // タッチ操作による移動
            if (this.touchX !== null && this.touchY !== null) {
                const targetY = this.touchY - this.touchOffset; // タッチ位置より上に目標位置を設定
                const dx = this.touchX - this.player.x;
                const dy = targetY - this.player.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 0) {
                    // より滑らかな移動のために移動速度を調整
                    const speed = Math.min(this.player.speed, distance);
                    this.player.x += (dx / distance) * speed;
                    this.player.y += (dy / distance) * speed;
                }
            }
            
            // 画面外に出ないように制限（上下の制限を調整）
            this.player.x = Math.max(0, Math.min(this.canvas.width - this.player.width, this.player.x));
            this.player.y = Math.max(0, Math.min(this.canvas.height - this.touchOffset, this.player.y));
            
            // 編隊の生成
            const currentTime = Date.now();
            if (currentTime - this.lastFormationTime > this.currentFormationInterval) {
                this.spawnFormation();
                this.lastFormationTime = currentTime;
            }

            // 敵の移動
            this.enemies.forEach(enemy => {
                if (enemy.formationIndex >= 0) {
                    // 編隊の敵の動き
                    const time = (currentTime - enemy.spawnTime) / 1000; // 秒単位の経過時間
                    
                    // 基本的な下方向への移動
                    enemy.y += enemy.speed;
                    
                    // 横方向の蛇行運動（サインカーブ）
                    enemy.x = enemy.baseX + Math.sin(time * 2) * 30;
                } else {
                    // 単独の敵の動き
                    enemy.y += enemy.speed;
                    enemy.x += Math.sin(enemy.y / 30) * 2;
                }

                // 画面外の敵を削除
                if (enemy.y > this.canvas.height) {
                    const index = this.enemies.indexOf(enemy);
                    if (index > -1) {
                        this.enemies.splice(index, 1);
                    }
                }
            });
            
            // 弾の生成
            if (currentTime - this.lastBulletTime > this.bulletInterval) {
                this.bullets.push({
                    x: this.player.x + this.player.width / 2 - 2,
                    y: this.player.y,
                    width: 4,
                    height: 10,
                    speed: 7
                });
                
                // 発射音を再生
                this.playShootSound();
                
                this.lastBulletTime = currentTime;
            }
            
            // 弾の移動と当たり判定
            this.bullets = this.bullets.filter(bullet => {
                bullet.y -= bullet.speed;
                
                // 敵との当たり判定
                this.enemies = this.enemies.filter(enemy => {
                    const hit = this.checkCollision(bullet, enemy);
                    if (hit) {
                        this.score++; // スコアを増加
                        this.addExplosion(enemy.x, enemy.y);
                        this.playExplosionSound();
                        return false;
                    }
                    return true;
                });
                
                return bullet.y > -bullet.height;
            });
        }

        // 爆発エフェクトの更新
        this.explosions = this.explosions.filter(explosion => {
            explosion.frameTime++;
            if (explosion.frameTime > 5) { // 5フレームごとにアニメーション更新
                explosion.frame++;
                explosion.frameTime = 0;
            }
            return explosion.frame < this.explosionSprites.length;
        });
    }
    
    spawnEnemy(x, y, formationIndex = -1) {
        const enemy = {
            x: x,
            y: y,
            width: 16,
            height: 16,
            speed: 2 + Math.random() * 1,
            angle: 0,
            formationIndex: formationIndex, // 編隊での位置を記録
            baseX: x, // 初期X位置を記録（蛇行運動の中心）
            spawnTime: Date.now() // 出現時刻を記録
        };
        this.enemies.push(enemy);
    }
    
    spawnFormation() {
        // スコアに応じて利用可能なパターンをフィルタリング
        const availablePatterns = this.formationPatterns.filter(
            pattern => this.score >= pattern.minScore
        );
        
        if (availablePatterns.length === 0) return;

        // ランダムにパターンを選択
        const pattern = availablePatterns[Math.floor(Math.random() * availablePatterns.length)];
        
        // 画面中央を基準に編隊を配置
        const baseX = this.canvas.width / 2;
        const baseY = -50;

        pattern.positions.forEach((pos, index) => {
            this.spawnEnemy(
                baseX + pos.x,
                baseY + pos.y,
                index
            );
        });

        // 次の編隊の間隔を設定（スコアが高いほど頻繁に）
        this.currentFormationInterval = Math.max(
            2000, // 最小間隔
            4000 - (this.score * 100) // スコアに応じて間隔を短縮
        );
    }
    
    checkCollision(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    }
    
    draw() {
        if (!this.isGameStarted) return;
        
        // 画面クリア
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 星の描画（レイヤーごとに）
        this.starLayers.forEach(layer => {
            layer.forEach(star => {
                this.ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
                this.ctx.beginPath();
                this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
                this.ctx.fill();
            });
        });
        
        // 建物の描画
        this.buildings.forEach(building => {
            const patternSize = {
                width: building.width / building.pattern[0].length,
                height: building.height / building.pattern.length
            };

            building.pattern.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell === 1) {
                        // 建物のパターンを描画
                        this.ctx.fillStyle = building.color;
                        this.ctx.fillRect(
                            building.x + x * patternSize.width,
                            building.y + y * patternSize.height,
                            patternSize.width,
                            patternSize.height
                        );
                    }
                });
            });
        });
        
        // 弾の描画をより派手に
        this.ctx.fillStyle = '#FFF';
        this.bullets.forEach(bullet => {
            // 弾の本体
            this.ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
            
            // 弾の光るエフェクト
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            this.ctx.beginPath();
            this.ctx.arc(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, 
                        bullet.width * 1.5, 0, Math.PI * 2);
            this.ctx.fill();
        });
        
        // ゲームオーバーでない場合のみプレイヤーを描画
        if (!this.isGameOver) {
            // プレイヤーの描画
            // 機体の描画（グレー）
            this.ctx.fillStyle = '#808080';  // グレー
            for (let y = 0; y < this.playerSprite.length; y++) {
                for (let x = 0; x < this.playerSprite[y].length; x++) {
                    if (this.playerSprite[y][x] === 1) {
                        this.ctx.fillRect(
                            this.player.x + x,
                            this.player.y + y,
                            1,
                            1
                        );
                    }
                }
            }
            
            // 窓ガラスの描画（青）
            this.ctx.fillStyle = '#00FFFF';  // シアン（青緑）
            this.windowPositions.forEach(pos => {
                this.ctx.fillRect(
                    this.player.x + pos.x,
                    this.player.y + pos.y,
                    1,
                    1
                );
            });
            
            // プレイヤーのエンジンエフェクト
            this.ctx.fillStyle = '#FFFF00';
            const engineGlow = Math.sin(Date.now() / 100) * 2 + 4;
            for (let x = 8; x < 12; x++) {
                this.ctx.fillRect(
                    this.player.x + x,
                    this.player.y + 19,
                    1,
                    engineGlow
                );
            }
        }

        // 敵の描画
        this.enemies.forEach(enemy => {
            // 敵の本体（赤色）
            this.ctx.fillStyle = '#FF0000';
            for (let y = 0; y < this.enemySprite.length; y++) {
                for (let x = 0; x < this.enemySprite[y].length; x++) {
                    if (this.enemySprite[y][x] === 1) {
                        this.ctx.fillRect(
                            enemy.x + x,
                            enemy.y + y,
                            1,
                            1
                        );
                    }
                }
            }
            
            // 敵の目（黄色）
            this.ctx.fillStyle = '#FFFF00';
            for (let y = 0; y < this.enemySprite.length; y++) {
                for (let x = 0; x < this.enemySprite[y].length; x++) {
                    if (this.enemySprite[y][x] === 2) {
                        this.ctx.fillRect(
                            enemy.x + x,
                            enemy.y + y,
                            1,
                            1
                        );
                    }
                }
            }
        });

        // 通常の爆発エフェクトの描画
        this.explosions.forEach(explosion => {
            const sprite = this.explosionSprites[explosion.frame];
            sprite.forEach((row, y) => {
                row.forEach((pixel, x) => {
                    if (pixel > 0) {
                        // 色の設定（1: オレンジ, 2: 黄色）
                        this.ctx.fillStyle = pixel === 1 ? '#FF4500' : '#FFFF00';
                        this.ctx.fillRect(
                            explosion.x + x * 2, // ピクセルサイズを2倍に
                            explosion.y + y * 2,
                            2,
                            2
                        );
                    }
                });
            });
        });

        // プレイヤーの爆発エフェクト描画
        if (this.playerExplosion) {
            const sprite = this.largeExplosionSprites[this.playerExplosion.frame];
            if (sprite) {  // フレームが存在する場合のみ描画
                sprite.forEach((row, y) => {
                    row.forEach((pixel, x) => {
                        if (pixel > 0) {
                            // 色の設定（1: オレンジ, 2: 黄色）
                            this.ctx.fillStyle = pixel === 1 ? '#FF4500' : '#FFFF00';
                            this.ctx.fillRect(
                                this.playerExplosion.x + x * 2,
                                this.playerExplosion.y + y * 2,
                                2,
                                2
                            );
                        }
                    });
                });
            }
        }

        // スコア表示
        this.ctx.font = '24px Arial';
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`撃破数: ${this.score}`, 10, 30);

        // ゲームオーバー表示
        if (this.isGameOver) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            this.ctx.font = '48px Arial';
            this.ctx.fillStyle = '#FF0000';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2 - 50);
            
            this.ctx.font = '32px Arial';
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillText(`最終撃破数: ${this.score}`, this.canvas.width / 2, this.canvas.height / 2 + 10);
        }
    }
    
    gameLoop() {
        if (!this.isGameStarted) return;
        
        this.update();
        this.draw();
        this.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }
    
    playShootSound() {
        // オシレーターの作成
        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        
        // 音量の設定
        gainNode.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
        
        // 周波数の設定（ピュンという効果のため、高い音から低い音に）
        oscillator.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(300, this.audioCtx.currentTime + 0.1);
        
        // 接続
        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        
        // 再生
        oscillator.start();
        oscillator.stop(this.audioCtx.currentTime + 0.2);
    }

    addExplosion(x, y) {
        this.explosions.push({
            x: x + 4, // 敵の中心付近に調整
            y: y + 4,
            frame: 0,
            frameTime: 0
        });
    }

    playExplosionSound() {
        try {
            // オシレーター1（低い音からノイズ）
            const oscillator1 = this.audioCtx.createOscillator();
            const gainNode1 = this.audioCtx.createGain();
            
            oscillator1.type = 'square'; // よりノイジーな音に
            oscillator1.frequency.setValueAtTime(150, this.audioCtx.currentTime);
            oscillator1.frequency.exponentialRampToValueAtTime(40, this.audioCtx.currentTime + 0.1);
            
            gainNode1.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
            gainNode1.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
            
            oscillator1.connect(gainNode1);
            gainNode1.connect(this.audioCtx.destination);
            
            // オシレーター2（高い音のノイズ）
            const oscillator2 = this.audioCtx.createOscillator();
            const gainNode2 = this.audioCtx.createGain();
            
            oscillator2.type = 'square';
            oscillator2.frequency.setValueAtTime(200, this.audioCtx.currentTime);
            oscillator2.frequency.exponentialRampToValueAtTime(80, this.audioCtx.currentTime + 0.05);
            
            gainNode2.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
            gainNode2.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.05);
            
            oscillator2.connect(gainNode2);
            gainNode2.connect(this.audioCtx.destination);
            
            // 再生開始
            oscillator1.start(this.audioCtx.currentTime);
            oscillator2.start(this.audioCtx.currentTime);
            
            // 再生終了
            oscillator1.stop(this.audioCtx.currentTime + 0.1);
            oscillator2.stop(this.audioCtx.currentTime + 0.05);
        } catch (error) {
            console.log('爆発音の再生に失敗しました:', error);
        }
    }

    addPlayerExplosion() {
        this.playerExplosion = {
            x: this.player.x,
            y: this.player.y,
            frame: 0,
            frameTime: 0
        };
    }

    playPlayerExplosionSound() {
        try {
            // より大きな爆発音を生成
            const oscillator1 = this.audioCtx.createOscillator();
            const gainNode1 = this.audioCtx.createGain();
            
            oscillator1.type = 'square';
            oscillator1.frequency.setValueAtTime(100, this.audioCtx.currentTime);
            oscillator1.frequency.exponentialRampToValueAtTime(20, this.audioCtx.currentTime + 0.5); // 長めに
            
            gainNode1.gain.setValueAtTime(0.4, this.audioCtx.currentTime);
            gainNode1.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.5);
            
            oscillator1.connect(gainNode1);
            gainNode1.connect(this.audioCtx.destination);
            
            // 高周波ノイズ
            const oscillator2 = this.audioCtx.createOscillator();
            const gainNode2 = this.audioCtx.createGain();
            
            oscillator2.type = 'square';
            oscillator2.frequency.setValueAtTime(300, this.audioCtx.currentTime);
            oscillator2.frequency.exponentialRampToValueAtTime(50, this.audioCtx.currentTime + 0.3);
            
            gainNode2.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
            gainNode2.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
            
            oscillator2.connect(gainNode2);
            gainNode2.connect(this.audioCtx.destination);
            
            oscillator1.start();
            oscillator2.start();
            oscillator1.stop(this.audioCtx.currentTime + 0.5); // 長めに
            oscillator2.stop(this.audioCtx.currentTime + 0.3);
        } catch (error) {
            console.log('プレイヤー爆発音の再生に失敗しました:', error);
        }
    }

    showRestartButton() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.startScreen.style.display = 'flex';
        this.startButton.textContent = 'リスタート';
    }

    initializeBuildings() {
        // 画面内に適度な間隔で建物を配置
        const additionalBuildings = [...this.buildings];
        additionalBuildings.forEach(building => {
            building = {...building, y: building.y - this.canvas.height};
        });
        this.buildings = [...this.buildings, ...additionalBuildings];
    }
}

// ゲームインスタンスの作成
window.onload = () => {
    new Game();
}; 