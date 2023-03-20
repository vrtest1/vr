// ゲームの設定
const ROWS = 20;
const COLS = 10;
const BLOCK_SIZE = 20;
const EMPTY_BLOCK = '#ccc';

// キャンバスの設定
const canvas = document.getElementById('canvas');
canvas.width = COLS * BLOCK_SIZE;
canvas.height = ROWS * BLOCK_SIZE;
const context = canvas.getContext('2d');

// ゲームの状態
let board = [];
let currentPiece;
let currentRow = 0;
let currentCol = 3;
let score = 0;
let isGameOver = false;

// ピースの種類と形
const pieces = [
    {
        color: 'cyan',
        blocks: [
            [1, 1, 1, 1]
        ]
    },
    {
        color: 'blue',
        blocks: [
            [1, 1, 1],
            [0, 0, 1]
        ]
    },
    {
        color: 'orange',
        blocks: [
            [1, 1, 1],
            [1, 0, 0]
        ]
    },
    {
        color: 'yellow',
        blocks: [
            [1, 1],
            [1, 1]
        ]
    },
    {
        color: 'green',
        blocks: [
            [0, 1, 1],
            [1, 1, 0]
        ]
    },
    {
        color: 'purple',
        blocks: [
            [1, 1, 0],
            [0, 1, 1]
        ]
    },
    {
        color: 'red',
        blocks: [
            [0, 1, 0],
            [1, 1, 1]
        ]
    }
];

// 新しいピースを生成する
function newPiece() {
    const randomIndex = Math.floor(Math.random() * pieces.length);
    const piece = pieces[randomIndex];
    currentPiece = piece.blocks;
}

// ボードを初期化する
function initBoard() {
    for (let row = 0; row < ROWS; row++) {
        board[row] = [];
        for (let col = 0; col < COLS; col++) {
            board[row][col] = EMPTY_BLOCK;
        }
    }
}

// ピースを描画する
function drawPiece() {
    for (let row = 0; row < currentPiece.length; row++) {
        for (let col = 0; col < currentPiece[row].length; col++) {
            if (currentPiece[row][col]) {
                const x = (currentCol + col) * BLOCK_SIZE;
                const y = (currentRow + row) * BLOCK_SIZE;
                drawBlock(x, y, currentPiece.color);
            }
        }
    }
}

// ボードを描画する
function drawBoard() {
    for (let row = 0; row <
// ボードの高さの範囲でループを回す
for (let row = 0; row < ROWS; row++) {
            // ボードの幅の範囲でループを回す
            for (let col = 0; col < COLS; col++) {
                // ブロックの色を取得
                const blockColor = board[row][col];
                // ブロックを描画する座標を計算
                const x = col * BLOCK_SIZE;
                const y = row * BLOCK_SIZE;
                // 空のブロック以外はブロックを描画する
                if (blockColor !== EMPTY_BLOCK) {
                    drawBlock(x, y, blockColor);
                }
            }
        }
}

// ブロックを描画する
function drawBlock(x, y, color) {
    context.fillStyle = color;
    context.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
}

// ピースを移動する
function movePiece(deltaRow, deltaCol) {
    currentRow += deltaRow;
    currentCol += deltaCol;
    // 移動先がボードの範囲外だった場合は移動をキャンセルする
    if (isCollision()) {
        currentRow -= deltaRow;
        currentCol -= deltaCol;
    }
}

// ピースを回転する
function rotatePiece() {
    const originalPiece = currentPiece;
    const rotatedPiece = [];
    for (let row = 0; row < originalPiece[0].length; row++) {
        rotatedPiece[row] = [];
        for (let col = 0; col < originalPiece.length; col++) {
            rotatedPiece[row][col] = originalPiece[originalPiece.length - 1 - col][row];
        }
    }
    currentPiece = rotatedPiece;
    // 回転後に衝突する場合は元の状態に戻す
    if (isCollision()) {
        currentPiece = originalPiece;
    }
}

// ピースが衝突しているかどうかを判定する
function isCollision() {
    for (let row = 0; row < currentPiece.length; row++) {
        for (let col = 0; col < currentPiece[row].length; col++) {
            if (currentPiece[row][col]) {
                const boardRow = currentRow + row;
                const boardCol = currentCol + col;
                if (boardRow < 0 || boardRow >= ROWS || boardCol < 0 || boardCol >= COLS || board[boardRow][boardCol] !== EMPTY_BLOCK) {
                    return true;
                }
            }
        }
    }
    return false;
}

// ピースをボードに固定する
function fixPiece() {
    for (let row = 0; row < currentPiece.length; row++) {
        for (let col = 0; col < currentPiece[row].length; col++) {
            if (currentPiece[row][col]) {
                board[currentRow + row][currentCol + col] = currentPiece.color;
            }
        }
    }
}

// 行が揃った場合に削除する
function deleteFullRows() {
    for (let row = 0; row < ROWS; row++) {
        if (board[row].every(block => block !== EMPTY_BLOCK)) {
            board.splice(row, 1);
            board.unshift(new Array(COLS).fill(EMPTY_BLOCK));
            score += 10;
        }
    }
}

// ゲームオーバーかどうかを判定する
function isGameOver() {
    return board[0].some(block => block !== EMPTY_BLOCK);
}

// 新しいピースを生成する
function generateNewPiece() {
    const randomIndex = Math.floor(Math.random() * PIECES.length);
    const piece = PIECES[randomIndex];
    return {
        shape: piece.shape,
        color: piece.color,
        row: -2,
        col: Math.floor(Math.random() * (COLS - piece.shape[0].length + 1))
    };
}

// ピースを落下させる
function dropPiece() {
    movePiece(1, 0);
    if (isCollision()) {
        fixPiece();
        deleteFullRows();
        currentPiece = generateNewPiece();
        currentRow = currentPiece.row;
        currentCol = currentPiece.col;
        if (isGameOver()) {
            clearInterval(gameInterval);
        }
    }
}

// キーボードが押されたときの処理
function handleKeyDown(event) {
    switch (event.keyCode) {
        case LEFT_ARROW:
            movePiece(0, -1);
            break;
        case RIGHT_ARROW:
            movePiece(0, 1);
            break;
        case DOWN_ARROW:
            dropPiece();
            break;
        case UP_ARROW:
            rotatePiece();
            break;
    }
}

// 初期化
let board = [];
let currentPiece = generateNewPiece();
let currentRow = currentPiece.row;
let currentCol = currentPiece.col;
let score = 0;

// ボードを初期化する
for (let row = 0; row < ROWS; row++) {
    board[row] = new Array(COLS).fill(EMPTY_BLOCK);
}

// キーボードイベントを追加する
document.addEventListener('keydown', handleKeyDown);

// ゲームループを開始する
const gameInterval = setInterval(() => {
    dropPiece();
    draw();
}, GAME_SPEED);

if (currentPiece.shape[row][col] !== EMPTY_BLOCK) {
    drawBlock(currentCol + col, currentRow + row, currentPiece.color);
}
}
}

// スコアを描画する
context.font = '24px Arial';
context.fillStyle = 'black';
context.fillText(Score: ${ score }, 20, 40);
}

// ブロックを描画する
function drawBlock(x, y, color) {
    context.fillStyle = color;
    context.fillRect(BLOCK_SIZE * x, BLOCK_SIZE * y, BLOCK_SIZE, BLOCK_SIZE);
    context.strokeStyle = 'white';
    context.strokeRect(BLOCK_SIZE * x, BLOCK_SIZE * y, BLOCK_SIZE, BLOCK_SIZE);
}

// 初期描画を行う
draw();

// コンソールにルールを表示する
console.log('=== Tetris === ←: move left →: move right ↓: move down ↑: rotate Score 10 points for each row you clear.');
