// Web Audio API Sound Synthesizer
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const SoundFX = {
  playTone: (freq, type, duration, volume = 0.1) => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  },
  
  playMove: () => SoundFX.playTone(150, 'square', 0.08, 0.05),
  playRotate: () => SoundFX.playTone(300, 'triangle', 0.05, 0.05),
  playRotateCCW: () => SoundFX.playTone(200, 'triangle', 0.05, 0.05),
  playDrop: () => SoundFX.playTone(100, 'sawtooth', 0.1, 0.08),
  
  playLineClear: () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      
      gainNode.gain.setValueAtTime(0.1, now + i * 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  },
  
  playGameOver: () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    const notes = [1046.50, 987.77, 880.00, 783.99, 659.25, 523.25];
    
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.15);
      
      gainNode.gain.setValueAtTime(0.1, now + i * 0.15);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.3);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.3);
    });
  },
  
  playLevelUp: () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      
      gainNode.gain.setValueAtTime(0.08, now + i * 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  },
  
  playTetris: () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    
    const arpeggio = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
    
    arpeggio.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = i % 2 === 0 ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.06);
      
      gainNode.gain.setValueAtTime(0.15, now + i * 0.06);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + i * 0.06 + 0.4);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.4);
    });
    
    const chord = [523.25, 659.25, 783.99, 1046.50];
    chord.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + 0.4 + i * 0.02);
      
      gainNode.gain.setValueAtTime(0.2, now + 0.4 + i * 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(now + 0.4 + i * 0.02);
      osc.stop(now + 1.2);
    });
  }
};

// Game Constants
const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 20; // キャンバス200x400pxに合わせて調整

// Tetromino definitions
const PIECES = [
  { shape: [[1, 1, 1, 1]], color: '#00f260', glow: '#0575e6' },
  { shape: [[1, 1], [1, 1]], color: '#fcb69f', glow: '#ee9ca7' },
  { shape: [[0, 1, 1], [1, 1, 0]], color: '#a18cd1', glow: '#fbc2eb' },
  { shape: [[1, 1, 0], [0, 1, 1]], color: '#ff416c', glow: '#ff4b2b' },
  { shape: [[1, 0, 0], [1, 1, 1]], color: '#84fab0', glow: '#8fd3f4' },
  { shape: [[0, 0, 1], [1, 1, 1]], color: '#f6d365', glow: '#fda085' },
  { shape: [[0, 1, 0], [1, 1, 1]], color: '#c4e538', glow: '#49fa76' }
];

// Game State
let canvas, ctx;
let nextCanvas, nextCtx;
let holdCanvas, holdCtx;
let board = [];
let currentPiece = null;
let nextPiece = null;
let heldPiece = null;
let holdUsed = false;
let score = 0;
let level = 1;
let highScore = localStorage.getItem('tetris_highscore') || 0;
let dropInterval = 800;
let lastDropTime = 0;
let gameActive = false;
let animationId = null;
let lastMoveWasRotation = false;
let lastKickUsed = 0;
let softDropStartTime = 0;
const SOFT_DROP_INTERVAL = 100;

function init() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');
  nextCanvas = document.getElementById('nextCanvas');
  nextCtx = nextCanvas.getContext('2d');
  holdCanvas = document.getElementById('holdCanvas');
  holdCtx = holdCanvas.getContext('2d');
  
  document.getElementById('highScore').textContent = highScore;
  
  // タッチコントロール
  setupTouchControls();
  
  document.getElementById('playBtn').addEventListener('click', startGame);
  document.getElementById('restartBtn').addEventListener('click', restartGame);
  
  requestAnimationFrame(gameLoop);
}

function setupTouchControls() {
  // 左ボタン
  const btnLeft = document.getElementById('btnLeft');
  btnLeft.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameActive && currentPiece) movePiece(-1, 0);
  });
  btnLeft.addEventListener('click', () => {
    if (gameActive && currentPiece) movePiece(-1, 0);
  });
  
  // 右ボタン
  const btnRight = document.getElementById('btnRight');
  btnRight.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameActive && currentPiece) movePiece(1, 0);
  });
  btnRight.addEventListener('click', () => {
    if (gameActive && currentPiece) movePiece(1, 0);
  });
  
  // 下ボタン（ソフトドロップ）
  const btnDown = document.getElementById('btnDown');
  btnDown.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameActive && currentPiece) {
      const now = Date.now();
      if (now - softDropStartTime > SOFT_DROP_INTERVAL) {
        if (movePiece(0, 1)) {
          SoundFX.playMove();
          softDropStartTime = now;
        }
      }
    }
  });
  btnDown.addEventListener('click', () => {
    if (gameActive && currentPiece) {
      const now = Date.now();
      if (now - softDropStartTime > SOFT_DROP_INTERVAL) {
        if (movePiece(0, 1)) {
          SoundFX.playMove();
          softDropStartTime = now;
        }
      }
    }
  });
  
  // 回転ボタン（時計回りのみ）
  const btnRotate = document.getElementById('btnRotate');
  btnRotate.addEventListener('touchstart', (e) => {
    e.preventDefault();
    rotatePiece(true);
  });
  btnRotate.addEventListener('click', () => {
    rotatePiece(true);
  });
  
  // Holdボタン
  const btnHold = document.getElementById('btnHold');
  btnHold.addEventListener('touchstart', (e) => {
    e.preventDefault();
    hold();
  });
  btnHold.addEventListener('click', () => {
    hold();
  });
  
  // ハードドロップボタン
  const btnHardDrop = document.getElementById('btnHardDrop');
  btnHardDrop.addEventListener('touchstart', (e) => {
    e.preventDefault();
    hardDrop();
  });
  btnHardDrop.addEventListener('click', () => {
    hardDrop();
  });
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function spawnPiece() {
  if (!nextPiece) {
    nextPiece = getRandomPiece();
  }
  
  currentPiece = nextPiece;
  currentPiece.x = Math.floor(COLS / 2) - Math.floor(currentPiece.shape[0].length / 2);
  currentPiece.y = 0;
  
  nextPiece = getRandomPiece();
  
  if (collide(board, currentPiece)) {
    gameOver();
  }
}

function getRandomPiece() {
  const index = Math.floor(Math.random() * PIECES.length);
  return {
    shape: JSON.parse(JSON.stringify(PIECES[index].shape)),
    color: PIECES[index].color,
    glow: PIECES[index].glow
  };
}

function collide(currentBoard, piece) {
  const shape = piece.shape;
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] !== 0) {
        const newX = piece.x + x;
        const newY = piece.y + y;
        
        if (newX < 0 || newX >= COLS || newY >= ROWS) {
          return true;
        }
        
        if (newY >= 0 && currentBoard[newY][newX] !== 0) {
          return true;
        }
      }
    }
  }
  return false;
}

function rotateMatrix(matrix, clockwise = true) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = Array.from({ length: cols }, () => Array(rows).fill(0));
  
  if (clockwise) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        result[x][rows - 1 - y] = matrix[y][x];
      }
    }
  } else {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        result[cols - 1 - x][y] = matrix[y][x];
      }
    }
  }
  
  return result;
}

function rotate(piece, clockwise = true) {
  const newShape = rotateMatrix(piece.shape, clockwise);
  
  if (!collide(board, { ...piece, shape: newShape })) {
    piece.shape = newShape;
    return true;
  }
  
  const kicks = [-1, 1, -2, 2];
  
  for (const kick of kicks) {
    const testPiece = { 
      ...piece, 
      shape: newShape, 
      x: piece.x + kick
    };
    if (!collide(board, testPiece)) {
      piece.shape = newShape;
      piece.x = piece.x + kick;
      return true;
    }
  }
  
  return false;
}

function movePiece(dx, dy) {
  const oldX = currentPiece.x;
  const oldY = currentPiece.y;
  
  currentPiece.x += dx;
  currentPiece.y += dy;
  
  if (collide(board, currentPiece)) {
    currentPiece.x = oldX;
    currentPiece.y = oldY;
    
    if (dy > 0) {
      lockPiece();
      return false;
    }
  }
  
  if (dx !== 0 || dy !== 0) {
    lastMoveWasRotation = false;
  }
  
  return true;
}

function hardDrop() {
  while (!collide(board, { ...currentPiece, y: currentPiece.y + 1 })) {
    currentPiece.y++;
  }
  SoundFX.playDrop();
  lastMoveWasRotation = false;
  lockPiece();
}

function isTSpin() {
  if (!currentPiece || currentPiece.shape.length !== 2 || currentPiece.shape[0].length !== 3) {
    return false;
  }
  
  if (!lastMoveWasRotation) {
    return false;
  }
  
  const centerX = currentPiece.x + 1;
  const centerY = currentPiece.y + 1;
  
  const corners = [
    { x: centerX - 1, y: centerY - 1 },
    { x: centerX + 1, y: centerY - 1 },
    { x: centerX - 1, y: centerY + 1 },
    { x: centerX + 1, y: centerY + 1 }
  ];
  
  let blockedCorners = 0;
  
  for (const corner of corners) {
    if (corner.x < 0 || corner.x >= COLS || corner.y >= ROWS) {
      blockedCorners++;
    } else if (corner.y >= 0 && board[corner.y][corner.x] !== 0) {
      blockedCorners++;
    }
  }
  
  return blockedCorners >= 3;
}

function lockPiece() {
  const shape = currentPiece.shape;
  
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] !== 0) {
        const boardY = currentPiece.y + y;
        if (boardY >= 0 && boardY < ROWS) {
          board[boardY][currentPiece.x + x] = { color: currentPiece.color, glow: currentPiece.glow };
        }
      }
    }
  }
  
  SoundFX.playDrop();
  
  const isSpin = isTSpin();
  const linesCleared = clearLines();
  
  if (linesCleared > 0) {
    if (isSpin) {
      const tspinScores = { 1: 800, 2: 1200, 3: 1600 };
      const points = (tspinScores[linesCleared] || 400) * level;
      score += points;
      SoundFX.playLineClear();
      console.log(`T-SPIN ${linesCleared} LINES! +${points} points`);
    } else if (linesCleared >= 4) {
      updateScore(linesCleared);
      SoundFX.playTetris();
      console.log(`TETRIS! +${1200 * level} points`);
    } else {
      updateScore(linesCleared);
      SoundFX.playLineClear();
    }
    updateUI();
  }
  
  spawnPiece();
  holdUsed = false;
  lastMoveWasRotation = false;
}

function clearLines() {
  let lines = 0;
  
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y].every(cell => cell !== 0)) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(0));
      lines++;
      y++;
    }
  }
  
  return lines;
}

function updateScore(lines) {
  const baseScores = [0, 40, 100, 300, 1200];
  const points = baseScores[lines] * level;
  
  score += points;
  
  if (score >= level * 1000) {
    level++;
    dropInterval = Math.max(100, 800 - (level - 1) * 50);
    SoundFX.playLevelUp();
  }
  
  updateUI();
}

function updateUI() {
  document.getElementById('score').textContent = score;
  document.getElementById('level').textContent = level;
  
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('tetris_highscore', highScore);
  }
  
  document.getElementById('highScore').textContent = highScore;
}

function drawBlock(ctx, x, y, color, glow) {
  const gradient = ctx.createLinearGradient(
    x * BLOCK_SIZE, y * BLOCK_SIZE,
    (x + 1) * BLOCK_SIZE, (y + 1) * BLOCK_SIZE
  );
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, glow);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  
  ctx.shadowColor = glow;
  ctx.shadowBlur = 10;
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (board[y][x] !== 0) {
        drawBlock(ctx, x, y, board[y][x].color, board[y][x].glow);
      }
    }
  }
  
  ctx.shadowBlur = 0;
}

function drawPiece(piece) {
  if (!piece) return;
  
  const shape = piece.shape;
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] !== 0) {
        drawBlock(ctx, piece.x + x, piece.y + y, piece.color, piece.glow);
      }
    }
  }
  
  ctx.shadowBlur = 0;
}

function drawNextPiece() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  
  if (!nextPiece) return;
  
  const shape = nextPiece.shape;
  const offsetX = (nextCanvas.width / BLOCK_SIZE - shape[0].length) / 2;
  const offsetY = (nextCanvas.height / BLOCK_SIZE - shape.length) / 2;
  
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] !== 0) {
        drawBlock(nextCtx, x + offsetX, y + offsetY, nextPiece.color, nextPiece.glow);
      }
    }
  }
  
  nextCtx.shadowBlur = 0;
}

function drawHold() {
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  
  const holdElement = document.querySelector('.hold-piece');
  if (holdUsed) {
    holdElement.classList.add('disabled');
  } else {
    holdElement.classList.remove('disabled');
  }
  
  if (!heldPiece) return;
  
  const shape = heldPiece.shape;
  const offsetX = (holdCanvas.width / BLOCK_SIZE - shape[0].length) / 2;
  const offsetY = (holdCanvas.height / BLOCK_SIZE - shape.length) / 2;
  
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] !== 0) {
        drawBlock(holdCtx, x + offsetX, y + offsetY, heldPiece.color, heldPiece.glow);
      }
    }
  }
  
  holdCtx.shadowBlur = 0;
}

function hold() {
  if (!gameActive || currentPiece === null || holdUsed) return;
  
  SoundFX.playRotate();
  
  if (heldPiece === null) {
    heldPiece = {
      shape: JSON.parse(JSON.stringify(currentPiece.shape)),
      color: currentPiece.color,
      glow: currentPiece.glow
    };
    currentPiece = null;
    spawnPiece();
  } else {
    const tempPiece = {
      shape: JSON.parse(JSON.stringify(currentPiece.shape)),
      color: currentPiece.color,
      glow: currentPiece.glow
    };
    currentPiece = {
      shape: JSON.parse(JSON.stringify(heldPiece.shape)),
      color: heldPiece.color,
      glow: heldPiece.glow,
      x: Math.floor(COLS / 2) - Math.floor(heldPiece.shape[0].length / 2),
      y: 0
    };
    heldPiece = tempPiece;
  }
  
  holdUsed = true;
  drawHold();
}

function drawGhost() {
  if (!currentPiece) return;
  
  let ghostY = currentPiece.y;
  while (!collide(board, { ...currentPiece, y: ghostY + 1 })) {
    ghostY++;
  }
  
  if (ghostY === currentPiece.y) return;
  
  ctx.globalAlpha = 0.15;
  const shape = currentPiece.shape;
  for (let y = 0; y < shape.length; y++) {
    for (let x = 0; x < shape[y].length; x++) {
      if (shape[y][x] !== 0) {
        drawBlock(ctx, currentPiece.x + x, ghostY + y, currentPiece.color, currentPiece.glow);
      }
    }
  }
  ctx.globalAlpha = 1.0;
  ctx.shadowBlur = 0;
}

function gameOver() {
  gameActive = false;
  cancelAnimationFrame(animationId);
  
  SoundFX.playGameOver();
  document.getElementById('finalScore').textContent = score;
  document.getElementById('gameOver').classList.remove('hidden');
}

function gameLoop(timestamp) {
  if (gameActive) {
    if (timestamp - lastDropTime > dropInterval) {
      movePiece(0, 1);
      lastDropTime = timestamp;
    }
    
    drawBoard();
    drawGhost();
    drawPiece(currentPiece);
    drawNextPiece();
    drawHold();
  }
  
  animationId = requestAnimationFrame(gameLoop);
}

function startGame() {
  board = createBoard();
  score = 0;
  level = 1;
  dropInterval = 800;
  heldPiece = null;
  holdUsed = false;
  lastMoveWasRotation = false;
  lastKickUsed = 0;
  
  updateUI();
  drawHold();
  
  document.getElementById('gameOver').classList.add('hidden');
  document.querySelector('.play-btn').style.display = 'none';
  
  spawnPiece();
  gameActive = true;
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  lastDropTime = performance.now();
  animationId = requestAnimationFrame(gameLoop);
}

function restartGame() {
  gameActive = false;
  cancelAnimationFrame(animationId);
  
  document.getElementById('gameOver').classList.add('hidden');
  document.querySelector('.play-btn').style.display = 'inline-block';
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  
  score = 0;
  level = 1;
  currentPiece = null;
  nextPiece = null;
  heldPiece = null;
  holdUsed = false;
  lastMoveWasRotation = false;
  lastKickUsed = 0;
  board = createBoard();
  document.getElementById('score').textContent = '0';
  document.getElementById('level').textContent = '1';
}

function rotatePiece(clockwise = true) {
  if (!gameActive || currentPiece === null) return;
  
  const rotated = rotate(currentPiece, clockwise);
  
  if (rotated) {
    lastMoveWasRotation = true;
    lastKickUsed = 0;
    SoundFX.playRotate();
  }
}

// PC版リンク用ボタン機能
document.addEventListener('DOMContentLoaded', () => {
  init();
});
