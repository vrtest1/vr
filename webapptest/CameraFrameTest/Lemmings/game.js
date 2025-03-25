const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 600;

class Lemming {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 20;
        this.height = 20;
        this.speed = 2;
        this.falling = true;
        this.skill = null;
    }

    update() {
        if (this.falling) {
            this.y += this.speed;
        } else {
            this.x += this.speed;
        }

        if (this.skill === 'dig') {
            this.y += 1;
        } else if (this.skill === 'bridge' && !this.falling) {
            platforms.push({x: this.x + this.width, y: this.y + this.height, width: 5, height: 5});
        }
    }

    draw() {
        ctx.fillStyle = this.skill ? 'red' : 'blue';
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }
}

const lemmings = [];
const platforms = [
    {x: 0, y: 550, width: 800, height: 50},
    {x: 200, y: 400, width: 200, height: 20},
];
const holes = [
    {x: 500, y: 550, width: 50, height: 50}
];
const goal = {x: 750, y: 500, width: 50, height: 50};

let score = 0;
let lemmingsLeft = 20;

function spawnLemming() {
    if (lemmingsLeft > 0) {
        lemmings.push(new Lemming(0, 0));
        lemmingsLeft--;
    }
}

function update() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // プラットフォームを描画
    ctx.fillStyle = 'green';
    platforms.forEach(platform => {
        ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    });

    // 穴を描画
    ctx.fillStyle = 'black';
    holes.forEach(hole => {
        ctx.fillRect(hole.x, hole.y, hole.width, hole.height);
    });

    // ゴールを描画
    ctx.fillStyle = 'gold';
    ctx.fillRect(goal.x, goal.y, goal.width, goal.height);

    // レミングスを更新・描画
    lemmings.forEach((lemming, index) => {
        lemming.update();
        lemming.draw();

        // 落下判定
        lemming.falling = true;
        platforms.forEach(platform => {
            if (
                lemming.x < platform.x + platform.width &&
                lemming.x + lemming.width > platform.x &&
                lemming.y + lemming.height <= platform.y &&
                lemming.y + lemming.height + lemming.speed > platform.y
            ) {
                lemming.falling = false;
                lemming.y = platform.y - lemming.height;
            }
        });

        // 穴に落ちた判定
        holes.forEach(hole => {
            if (
                lemming.x < hole.x + hole.width &&
                lemming.x + lemming.width > hole.x &&
                lemming.y + lemming.height > hole.y
            ) {
                lemmings.splice(index, 1);
            }
        });

        // ゴール判定
        if (
            lemming.x < goal.x + goal.width &&
            lemming.x + lemming.width > goal.x &&
            lemming.y < goal.y + goal.height &&
            lemming.y + lemming.height > goal.y
        ) {
            score++;
            lemmings.splice(index, 1);
        }
    });

    // UIの描画
    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.fillText(`Score: ${score}`, 10, 30);
    ctx.fillText(`Lemmings left: ${lemmingsLeft}`, 10, 60);

    requestAnimationFrame(update);
}

// 3秒ごとにレミングスを生成
setInterval(spawnLemming, 3000);

// クリックでスキルを付与
canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    lemmings.forEach(lemming => {
        if (
            x > lemming.x && x < lemming.x + lemming.width &&
            y > lemming.y && y < lemming.y + lemming.height
        ) {
            lemming.skill = lemming.skill === 'dig' ? 'bridge' : 'dig';
        }
    });
});

update();