document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('video');
    const overlay = document.getElementById('overlay');
    const ctx = overlay.getContext('2d');

    // カメラストリームの取得
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true })
        .then(stream => {
            video.srcObject = stream;
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            function draw() {
                overlay.width = video.videoWidth;
                overlay.height = video.videoHeight;

                analyser.getByteFrequencyData(dataArray);

                ctx.clearRect(0, 0, overlay.width, overlay.height);
                ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';

                const barWidth = overlay.width / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = (dataArray[i] / 255) * overlay.height;
                    ctx.fillRect(x, overlay.height - barHeight, barWidth, barHeight);
                    x += barWidth + 1;
                }

                requestAnimationFrame(draw);
            }

            video.onloadedmetadata = () => {
                draw();
            };
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
        });
});