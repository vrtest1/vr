const lamp = document.querySelector('.liquid');
const root = document.documentElement;
const lampColor = document.getElementById('lamp-color');
const blobColor1 = document.getElementById('blob-color1');
const blobColor2 = document.getElementById('blob-color2');

function updateColors() {
    root.style.setProperty('--lamp-color', lampColor.value);
    root.style.setProperty('--blob-color1', blobColor1.value);
    root.style.setProperty('--blob-color2', blobColor2.value);
}

lampColor.addEventListener('input', updateColors);
blobColor1.addEventListener('input', updateColors);
blobColor2.addEventListener('input', updateColors);

function createBlob() {
    const blob = document.createElement('div');
    blob.className = 'blob';

    const size = Math.random() * 30 + 20; // サイズをさらに小さくしました
    blob.style.width = `${size}px`;
    blob.style.height = `${size}px`;

    const x = Math.random() * 160 + 10; // 左右の範囲をさらに広げました
    blob.style.left = `${x}px`;
    blob.style.top = '350px';

    const animationDuration = Math.random() * 250 + 20; // アニメーション時間をさらに長くしました
    blob.style.animationDuration = `${animationDuration}s`;

    const borderRadius = `${50 + Math.random() * 20}% ${50 + Math.random() * 20}% ${50 + Math.random() * 20}% ${50 + Math.random() * 20}%`;
    blob.style.borderRadius = borderRadius;

    lamp.appendChild(blob);

    moveBlob(blob);
}

function moveBlob(blob) {
    const animationDuration = parseFloat(blob.style.animationDuration) * 1000;
    const start = performance.now();
    const moveDistance = 300;

    function animate(time) {
        let timeFraction = (time - start) / animationDuration;
        if (timeFraction > 1) timeFraction = 1;

        const easedTimeFraction = easeInOutQuad(timeFraction);
        const y = 350 - easedTimeFraction * moveDistance;
        blob.style.top = `${y}px`;

        if (timeFraction < 1) {
            requestAnimationFrame(animate);
        } else {
            splitBlob(blob);
        }
    }

    requestAnimationFrame(animate);
}

function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function splitBlob(blob) {
    const newSize = parseFloat(blob.style.width) * 0.8; // 分裂後のサイズ減少を緩和

    for (let i = 0; i < 2; i++) {
        const newBlob = document.createElement('div');
        newBlob.className = 'blob';
        newBlob.style.width = `${newSize}px`;
        newBlob.style.height = `${newSize}px`;
        newBlob.style.left = blob.style.left;
        newBlob.style.top = blob.style.top;
        newBlob.style.borderRadius = blob.style.borderRadius;
        newBlob.style.background = blob.style.background;
        newBlob.style.filter = blob.style.filter;
        newBlob.style.mixBlendMode = blob.style.mixBlendMode;
        newBlob.style.position = 'absolute';

        lamp.appendChild(newBlob);

        fallBlob(newBlob, i);
    }

    lamp.removeChild(blob);
}

function fallBlob(blob, index) {
    const animationDuration = Math.random() * 1200 + 8; // 落下時間をさらに長くしました
    const start = performance.now();
    const startY = parseFloat(blob.style.top);
    const fallDistance = 350 - startY;

    function animate(time) {
        let timeFraction = (time - start) / (animationDuration * 1000);
        if (timeFraction > 1) timeFraction = 1;

        const easedTimeFraction = easeInOutQuad(timeFraction);
        const y = startY + easedTimeFraction * fallDistance;

        blob.style.top = `${y}px`;
        blob.style.opacity = 1 - timeFraction;

        if (timeFraction < 1) {
            requestAnimationFrame(animate);
        } else {
            lamp.removeChild(blob);
        }
    }

    requestAnimationFrame(animate);
}

function createBlobs(count) {
    for (let i = 0; i < count; i++) {
        createBlob();
    }
}

createBlobs(20); // 初期ブロブの数をさらに増やしました

setInterval(() => {
    if (document.querySelectorAll('.blob').length < 25) { // ブロブの最大数をさらに増やしました
        createBlob();
    }
}, 1500); // ブロブ生成の間隔をさらに短くしました

const colorUI = document.getElementById('color-ui');
const body = document.body;

function toggleColorUI(event) {
    if (event.target !== colorUI && !colorUI.contains(event.target)) {
        colorUI.style.display = colorUI.style.display === 'none' ? 'block' : 'none';
    }
}

body.addEventListener('click', toggleColorUI);
body.addEventListener('touchend', function(e) {
    e.preventDefault(); // タッチ後のクリックイベント発火を防ぐ
    toggleColorUI(e);
});
