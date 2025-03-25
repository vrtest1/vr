document.addEventListener('DOMContentLoaded', () => {
    // キャンバスの設定
    const canvas = document.getElementById('game-board');
    const ctx = canvas.getContext('2d');
    const scoreElement = document.getElementById('score');
    const startBtn = document.getElementById('start-btn');

    // ゲーム設定
    const ROWS = 20;
    const COLS = 10;
    const BLOCK_SIZE = 30;
    const EMPTY = '#111';
    const COLORS = [
        '#FF0D72', // Z
        '#0DC2FF', // J
        '#0DFF72', // L
        '#F538FF', // O
        '#FF8E0D', // S
        '#FFE138', // T
        '#3877FF'  // I
    ];

    // テトロミノ形状
    const SHAPES = [
        [[1, 1, 0], [0, 1, 1]], // Z
        [[0, 0, 1], [1, 1, 1]], // J
        [[1, 0, 0], [1, 1, 1]], // L
        [[1, 1], [1, 1]],       // O
        [[0, 1, 1], [1, 1, 0]], // S
        [[0, 1, 0], [1, 1, 1]], // T
        [[0, 0, 0, 0], [1, 1, 1, 1]] // I
    ];

    // ゲーム変数
    let board = [];
    let currentPiece = null;
    let score = 0;
    let gameOver = true;
    let animationId = null;
    let dropStart = 0;
    let gameSpeed = 1000; // 1秒ごとにブロックが落下

    // ボードの初期化
    function initBoard() {
        board = [];
        for (let r = 0; r < ROWS; r++) {
            board[r] = [];
            for (let c = 0; c < COLS; c++) {
                board[r][c] = EMPTY;
            }
        }
    }

    // ボードの描画
    function drawBoard() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                drawBlock(c, r, board[r][c]);
            }
        }
    }

    // ブロックの描画
    function drawBlock(x, y, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        ctx.strokeStyle = '#333';
        ctx.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    }

    // テトロミノのクラス
    class Piece {
        constructor(shape, color) {
            this.shape = shape;
            this.color = color;
            this.x = Math.floor(COLS / 2) - Math.floor(shape[0].length / 2);
            this.y = 0;
        }

        // テトロミノの描画
        draw() {
            for (let r = 0; r < this.shape.length; r++) {
                for (let c = 0; c < this.shape[r].length; c++) {
                    if (this.shape[r][c]) {
                        drawBlock(this.x + c, this.y + r, this.color);
                    }
                }
            }
        }

        // 衝突判定
        collision(x, y, shape) {
            for (let r = 0; r < shape.length; r++) {
                for (let c = 0; c < shape[r].length; c++) {
                    if (!shape[r][c]) continue;
                    
                    let newX = this.x + c + x;
                    let newY = this.y + r + y;
                    
                    if (newX < 0 || newX >= COLS || newY >= ROWS) {
                        return true;
                    }
                    
                    if (newY < 0) {
                        continue;
                    }
                    
                    if (board[newY][newX] !== EMPTY) {
                        return true;
                    }
                }
            }
            return false;
        }

        // 移動
        move(x, y) {
            if (!this.collision(x, y, this.shape)) {
                this.x += x;
                this.y += y;
                return true;
            }
            return false;
        }

        // 回転
        rotate() {
            let newShape = [];
            for (let c = 0; c < this.shape[0].length; c++) {
                newShape[c] = [];
                for (let r = this.shape.length - 1; r >= 0; r--) {
                    newShape[c].push(this.shape[r][c]);
                }
            }
            
            if (!this.collision(0, 0, newShape)) {
                this.shape = newShape;
            }
        }

        // 即時落下
        hardDrop() {
            while (this.move(0, 1)) {
                // 一番下まで移動する
            }
            this.lock();
        }

        // ボードに固定
        lock() {
            for (let r = 0; r < this.shape.length; r++) {
                for (let c = 0; c < this.shape[r].length; c++) {
                    if (!this.shape[r][c]) continue;
                    
                    // ゲームオーバー判定
                    if (this.y + r < 0) {
                        gameOver = true;
                        cancelAnimationFrame(animationId);
                        startBtn.textContent = 'ゲームスタート';
                        return;
                    }
                    
                    board[this.y + r][this.x + c] = this.color;
                }
            }
            
            // ラインが揃ったか確認
            let linesCleared = 0;
            for (let r = 0; r < ROWS; r++) {
                let isLineComplete = true;
                for (let c = 0; c < COLS; c++) {
                    if (board[r][c] === EMPTY) {
                        isLineComplete = false;
                        break;
                    }
                }
                
                if (isLineComplete) {
                    // ラインを削除して上から詰める
                    for (let y = r; y > 0; y--) {
                        for (let c = 0; c < COLS; c++) {
                            board[y][c] = board[y-1][c];
                        }
                    }
                    // 一番上の行をクリア
                    for (let c = 0; c < COLS; c++) {
                        board[0][c] = EMPTY;
                    }
                    
                    linesCleared++;
                }
            }
            
            // スコア更新
            if (linesCleared > 0) {
                // ライン消去に応じてスコア加算（1行:100, 2行:300, 3行:500, 4行:800）
                const points = [0, 100, 300, 500, 800];
                score += points[linesCleared];
                scoreElement.textContent = `スコア: ${score}`;
                
                // スピードアップ（10000点ごとに少しスピードアップ）
                gameSpeed = Math.max(100, 1000 - Math.floor(score / 10000) * 100);
            }
            
            // 新しいピースを生成
            generatePiece();
        }
    }

    // 新しいピースの生成
    function generatePiece() {
        const randomIndex = Math.floor(Math.random() * SHAPES.length);
        const shape = SHAPES[randomIndex];
        const color = COLORS[randomIndex];
        currentPiece = new Piece(shape, color);
        
        // 生成直後に衝突する場合はゲームオーバー
        if (currentPiece.collision(0, 0, currentPiece.shape)) {
            gameOver = true;
            cancelAnimationFrame(animationId);
            startBtn.textContent = 'ゲームスタート';
        }
    }

    // キー操作の処理
    document.addEventListener('keydown', (e) => {
        if (gameOver) return;
        
        switch (e.keyCode) {
            case 37: // 左矢印
                currentPiece.move(-1, 0);
                break;
            case 39: // 右矢印
                currentPiece.move(1, 0);
                break;
            case 40: // 下矢印
                currentPiece.move(0, 1);
                dropStart = Date.now(); // リセットして落下タイミングを調整
                break;
            case 38: // 上矢印
                currentPiece.rotate();
                break;
            case 32: // スペース
                currentPiece.hardDrop();
                break;
        }
    });

    // ゲームループ
    function gameLoop() {
        if (gameOver) return;
        
        animationId = requestAnimationFrame(gameLoop);
        
        // 現在の時間
        const now = Date.now();
        
        // 前回の落下から一定時間経過したら落下
        if (now - dropStart > gameSpeed) {
            if (!currentPiece.move(0, 1)) {
                currentPiece.lock();
            }
            dropStart = now;
        }
        
        // キャンバスをクリア
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // ボードとピースの描画
        drawBoard();
        currentPiece.draw();
    }

    // ゲーム開始
    function startGame() {
        if (!gameOver) {
            // 一時停止
            gameOver = true;
            cancelAnimationFrame(animationId);
            startBtn.textContent = 'ゲームスタート';
        } else {
            // ゲーム開始・再開
            gameOver = false;
            initBoard();
            generatePiece();
            dropStart = Date.now();
            score = 0;
            scoreElement.textContent = `スコア: ${score}`;
            startBtn.textContent = '一時停止';
            gameLoop();
        }
    }

    // スタートボタンのイベントリスナー
    startBtn.addEventListener('click', startGame);

    // ゲームの初期化
    initBoard();
});