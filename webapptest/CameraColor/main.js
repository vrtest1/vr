const video = document.getElementById('video');
const colorDisplay = document.getElementById('colorDisplay');
const colorInfo = document.getElementById('colorInfo');
const crosshair = document.querySelector('.crosshair');

// カメラ映像を取得する関数
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        video.srcObject = stream;
        console.log('カメラストリームを取得しました');
    } catch (err) {
        console.error('カメラの取得に失敗しました:', err);
        alert('カメラの取得に失敗しました。カメラへのアクセスを許可してください。');
    }
}

// 中央の色を抽出する関数
function extractCenterColor() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 50; // 中央の正方形のサイズ

    // ビデオのサイズを取得
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) {
        console.log('ビデオのサイズが取得できません');
        return null;
    }

    canvas.width = size;
    canvas.height = size;

    // ビデオの中央部分を取得
    const centerX = Math.floor((videoWidth - size) / 2);
    const centerY = Math.floor((videoHeight - size) / 2);

    try {
        ctx.drawImage(video, centerX, centerY, size, size, 0, 0, size, size);
        
        // 中央部分の平均色を計算
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;
        let r = 0, g = 0, b = 0;

        for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
        }

        const pixelCount = (size * size);
        r = Math.round(r / pixelCount);
        g = Math.round(g / pixelCount);
        b = Math.round(b / pixelCount);

        console.log(`抽出した色: RGB(${r}, ${g}, ${b})`);
        return { r, g, b };
    } catch (err) {
        console.error('色の抽出に失敗しました:', err);
        return null;
    }
}

// 色情報を表示する関数
function updateColorDisplay(r, g, b) {
    const color = `rgb(${r}, ${g}, ${b})`;
    colorDisplay.style.backgroundColor = color;

    // HSL値の計算
    const [h, s, l] = rgbToHsl(r, g, b);
    
    // ntc.jsを使用して色名を取得
    const colorName = ntc.name(color)[1];
    
    colorInfo.innerHTML = `
        色名: ${colorName}<br>
        RGB: (${r}, ${g}, ${b})<br>
        HSL: (${Math.round(h)}°, ${Math.round(s*100)}%, ${Math.round(l*100)}%)
    `;
}

// RGB から HSL への変換関数
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }

        h *= 60;
    }

    return [h, s, l];
}

// メインループ
function mainLoop() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        crosshair.style.display = 'block'; // 測定エリアを表示
        const color = extractCenterColor();
        if (color) {
            updateColorDisplay(color.r, color.g, color.b);
        }
    }
    requestAnimationFrame(mainLoop);
}

// アプリケーションの開始
startCamera();
video.addEventListener('loadedmetadata', () => {
    console.log('ビデオのメタデータを読み込みました');
    crosshair.style.display = 'block';
    mainLoop();
}); 