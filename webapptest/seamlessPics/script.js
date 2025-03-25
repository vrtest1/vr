document.addEventListener('DOMContentLoaded', () => {
    const image1 = document.getElementById('image1');
    const image2 = document.getElementById('image2');

    function initOrientationListener() {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ の Safari
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    } else {
                        console.log('許可が得られませんでした');
                    }
                })
                .catch(console.error);
        } else if (window.DeviceOrientationEvent) {
            // 他のデバイスまたは古い iOS
            window.addEventListener('deviceorientation', handleOrientation);
        } else {
            console.log('デバイスの向きがサポートされていません');
        }
    }

    // ページ上にボタンを追加
    const button = document.createElement('button');
    button.textContent = '角度センサーを有効にする';
    document.body.insertBefore(button, document.body.firstChild);

    button.addEventListener('click', initOrientationListener);

function handleOrientation(event) {
    const beta = event.beta; // X軸周りの回転（-180°〜180°）
    console.log('Device orientation beta:', beta);

    if (beta > 20 && beta <= 160) {  // 閾値を調整
        console.log('Showing image1');
        image1.classList.add('active');
        image2.classList.remove('active');
    } else {
        console.log('Showing image2');
        image1.classList.remove('active');
        image2.classList.add('active');
    }
}
});