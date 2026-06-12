class Ball {
    constructor(x, y, radius, color, ownerPlayer = null, kind = 'stake') {
        this.x = x;
        this.y = y;
        this.z = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.radius = radius;
        this.color = color;
        this.ownerPlayer = ownerPlayer;
        this.kind = kind;
        this.isMainBall = kind === 'main';
        this.inSquare = true;
        this.eliminated = false;
        this.wonByPlayerId = null;
        this.maxZ = 0;
        this.bounceCount = 0;
    }

    isMoving() {
        return Math.hypot(this.vx, this.vy) > 0.08 || Math.abs(this.vz) > 0.08 || this.z > 0;
    }

    update(friction) {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= friction;
        this.vy *= friction;

        if (this.z > 0 || Math.abs(this.vz) > 0.05) {
            this.z += this.vz;
            this.vz -= 0.3;
            this.maxZ = Math.max(this.maxZ, this.z);

            if (this.z <= 0) {
                if (this.maxZ > 1) this.bounceCount++;
                this.z = 0;
                this.vz *= -0.24;
                if (Math.abs(this.vz) < 0.35) this.vz = 0;
            }
        }

        if (Math.hypot(this.vx, this.vy) < 0.08 && this.z === 0) {
            this.vx = 0;
            this.vy = 0;
        }
    }

    checkBounds(width, height) {
        const damp = -0.55;

        if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.vx *= damp;
        } else if (this.x + this.radius > width) {
            this.x = width - this.radius;
            this.vx *= damp;
        }

        if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.vy *= damp;
        } else if (this.y + this.radius > height) {
            this.y = height - this.radius;
            this.vy *= damp;
        }
    }

    draw(ctx) {
        if (this.eliminated) return;

        const lift = Math.max(0, this.z);
        const shadowAlpha = 0.14 + Math.min(lift, 22) * 0.012;
        const drawY = this.y - lift * 0.28;

        ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
        ctx.beginPath();
        ctx.ellipse(this.x + lift * 0.05, this.y + this.radius * 0.65, this.radius * 0.95, this.radius * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();

        const gradient = ctx.createRadialGradient(
            this.x - this.radius * 0.35,
            drawY - this.radius * 0.4,
            this.radius * 0.1,
            this.x,
            drawY,
            this.radius
        );
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.18, this.color);
        gradient.addColorStop(1, '#111111');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, drawY, this.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = this.isMainBall ? '#ffffff' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = this.isMainBall ? 2.5 : 1.25;
        ctx.stroke();
    }
}

class GameEngine {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.pointer = { x: 0, y: 0 };

        this.config = {
            ballRadius: 10,
            mainBallRadius: 13,
            friction: 0.955,
            collisionDamping: 1.08,
            maxVelocity: 18,
            aimAssistRange: 300,
            aimAssistWidth: 32,
            hitBoost: 2.4
        };

        this.playerColors = ['#ef4444', '#14b8a6', '#38bdf8', '#f97316', '#a3e635', '#c084fc'];
        this.players = [];
        this.balls = [];
        this.scores = {};
        this.qualificationResults = {};
        this.qualificationOrder = [];
        this.mode = 'MANUAL';
        this.phase = 'SETUP';
        this.round = 1;
        this.numPlayers = 2;
        this.stakePerPlayer = 2;
        this.currentPlayerIndex = 0;
        this.mainBall = null;
        this.shootDirection = null;
        this.aimAssistTarget = null;
        this.shootPower = 0;
        this.awaitingShot = false;
        this.turnEndScheduled = false;
        this.currentTurnEjectedBall = false;
        this.lastEvent = '';
        this.shootTimeout = null;

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.setupEventListeners();
        this.reset();
        this.gameLoop();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.computeBoard();
    }

    computeBoard() {
        const shortest = Math.min(this.canvas.width, this.canvas.height);
        this.squareSize = Math.max(92, Math.min(150, shortest * 0.18));
        this.squareLeft = this.canvas.width / 2 - this.squareSize / 2;
        this.squareTop = this.canvas.height / 2 - this.squareSize / 2;
        this.squareRight = this.squareLeft + this.squareSize;
        this.squareBottom = this.squareTop + this.squareSize;
        this.qualLineX1 = this.squareLeft - this.squareSize * 0.55;
        this.qualLineX2 = this.squareRight + this.squareSize * 0.55;
        this.qualLineY1 = this.squareTop - this.squareSize * 0.85;
        this.qualLineY2 = this.squareBottom + this.squareSize * 0.85;
        this.shootLineY = Math.min(this.canvas.height - 52, Math.max(this.canvas.height - 92, this.squareBottom + 110));
        this.qualTargetY = Math.min(this.shootLineY - 58, this.squareBottom + this.squareSize * 0.48);
        this.wonBallsArea = {
            x: Math.max(16, this.canvas.width - 116),
            y: 88,
            width: 96,
            height: Math.max(180, this.canvas.height - 176)
        };
    }

    setupEventListeners() {
        this.canvas.addEventListener('pointermove', (event) => this.handlePointerMove(event));
        this.canvas.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
        document.addEventListener('keydown', (event) => this.handleKeyPress(event.key));

        document.getElementById('playerCount').addEventListener('change', () => this.reset());
        document.getElementById('stakeCount').addEventListener('change', () => this.reset());
    }

    readSettings() {
        const playerInput = document.getElementById('playerCount');
        const stakeInput = document.getElementById('stakeCount');
        this.numPlayers = Math.max(2, Math.min(6, Number.parseInt(playerInput.value, 10) || 2));
        this.stakePerPlayer = Math.max(1, Math.min(8, Number.parseInt(stakeInput.value, 10) || 2));
        playerInput.value = String(this.numPlayers);
        stakeInput.value = String(this.stakePerPlayer);
    }

    createPlayers() {
        this.players = Array.from({ length: this.numPlayers }, (_, index) => {
            const id = index + 1;
            this.scores[id] = this.scores[id] || 0;
            return {
                id,
                name: `Joueur ${id}`,
                color: this.playerColors[index],
                mainBallColor: this.playerColors[index]
            };
        });
    }

    reset() {
        this.clearShootTimeout();
        this.readSettings();
        this.scores = {};
        this.createPlayers();
        this.balls = [];
        this.round = 1;
        this.currentPlayerIndex = 0;
        this.qualificationResults = {};
        this.qualificationOrder = [];
        this.lastEvent = '';
        this.startMisePhase();
    }

    clearShootTimeout() {
        if (this.shootTimeout) {
            clearTimeout(this.shootTimeout);
            this.shootTimeout = null;
        }
    }

    startMisePhase() {
        this.phase = 'MISE';
        this.currentPlayerIndex = 0;
        this.mainBall = null;
        this.awaitingShot = false;
        this.turnEndScheduled = false;
        this.currentTurnEjectedBall = false;
        this.balls = [];

        const columns = Math.ceil(Math.sqrt(this.numPlayers * this.stakePerPlayer));
        const spacing = Math.max(this.config.ballRadius * 2.6, this.squareSize / (columns + 1));
        let placed = 0;

        for (const player of this.players) {
            for (let stake = 0; stake < this.stakePerPlayer; stake++) {
                const col = placed % columns;
                const row = Math.floor(placed / columns);
                const x = this.squareLeft + spacing + col * spacing + (Math.random() - 0.5) * 5;
                const y = this.squareTop + spacing + row * spacing + (Math.random() - 0.5) * 5;
                this.balls.push(new Ball(
                    Math.min(this.squareRight - this.config.ballRadius, Math.max(this.squareLeft + this.config.ballRadius, x)),
                    Math.min(this.squareBottom - this.config.ballRadius, Math.max(this.squareTop + this.config.ballRadius, y)),
                    this.config.ballRadius,
                    player.color,
                    player.id
                ));
                placed++;
            }
        }

        this.showStatus(this.mode === 'DEMO' ? 'Mode demo: qualification automatique.' : 'Cliquez sur le terrain pour commencer.');
        if (this.mode === 'DEMO') {
            this.shootTimeout = setTimeout(() => this.startQualificationPhase(), 1000);
        }
    }

    startQualificationPhase() {
        this.phase = 'QUALIFICATION';
        this.currentPlayerIndex = 0;
        this.qualificationResults = {};
        this.qualificationOrder = [];
        this.spawnMainBall();
    }

    startTirPhase() {
        this.phase = 'TIR';
        this.currentPlayerIndex = 0;
        this.spawnMainBall();
    }

    spawnMainBall() {
        this.clearShootTimeout();
        this.balls = this.balls.filter((ball) => !ball.isMainBall);
        const player = this.players[this.currentPlayerIndex];
        this.mainBall = new Ball(
            this.canvas.width / 2,
            this.shootLineY,
            this.config.mainBallRadius,
            player.mainBallColor,
            player.id,
            'main'
        );
        this.mainBall.inSquare = false;
        this.balls.push(this.mainBall);
        this.shootDirection = null;
        this.aimAssistTarget = null;
        this.shootPower = 0;
        this.awaitingShot = true;
        this.turnEndScheduled = false;
        this.currentTurnEjectedBall = false;

        if (this.mode === 'DEMO') {
            this.shootTimeout = setTimeout(() => this.autoShoot(), 900);
        }
    }

    handlePointerMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = event.clientX - rect.left;
        this.pointer.y = event.clientY - rect.top;
        this.updateAimFromPointer();
    }

    handlePointerDown(event) {
        this.handlePointerMove(event);

        if (this.mode !== 'MANUAL') return;
        if (this.phase === 'MISE') {
            this.startQualificationPhase();
            return;
        }

        if ((this.phase === 'QUALIFICATION' || this.phase === 'TIR') && this.awaitingShot) {
            this.shootMainBall();
        }
    }

    handleKeyPress(key) {
        if (key === ' ' && this.phase === 'MISE' && this.mode === 'MANUAL') this.startQualificationPhase();
        if (key === 'r' || key === 'R') this.reset();
        if (key === 'm' || key === 'M') this.toggleMode();
    }

    updateAimFromPointer() {
        if (!this.mainBall || !this.awaitingShot || (this.phase !== 'QUALIFICATION' && this.phase !== 'TIR')) return;

        const dx = this.pointer.x - this.mainBall.x;
        const dy = this.pointer.y - this.mainBall.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 8) {
            this.shootDirection = null;
            this.aimAssistTarget = null;
            this.shootPower = 0;
            return;
        }

        this.shootDirection = {
            x: dx / distance,
            y: dy / distance
        };
        this.aimAssistTarget = null;
        if (this.phase === 'TIR') {
            const assisted = this.getAssistedAim(this.shootDirection);
            this.shootDirection = assisted.direction;
            this.aimAssistTarget = assisted.target;
        }
        this.shootPower = Math.min(distance, 180) / 180;
    }

    shootMainBall() {
        if (!this.mainBall || !this.shootDirection) return;

        const velocity = 6.5 + this.shootPower * this.config.maxVelocity;
        this.mainBall.vx = this.shootDirection.x * velocity;
        this.mainBall.vy = this.shootDirection.y * velocity;
        this.mainBall.vz = this.phase === 'QUALIFICATION'
            ? 2.2 + this.shootPower * 2.4
            : 0.35 + this.shootPower * 0.35;
        this.awaitingShot = false;
        this.shootDirection = null;
        this.aimAssistTarget = null;
        this.shootPower = 0;
    }

    getAssistedAim(direction) {
        if (!this.mainBall) return { direction, target: null };

        let best = null;
        for (const ball of this.balls) {
            if (ball.isMainBall || ball.eliminated) continue;

            const dx = ball.x - this.mainBall.x;
            const dy = ball.y - this.mainBall.y;
            const forward = dx * direction.x + dy * direction.y;
            if (forward <= 0 || forward > this.config.aimAssistRange) continue;

            const side = Math.abs(dx * direction.y - dy * direction.x);
            if (side > this.config.aimAssistWidth + ball.radius) continue;

            const score = side * 3 + forward * 0.12;
            if (!best || score < best.score) {
                const distance = Math.max(1, Math.hypot(dx, dy));
                best = {
                    score,
                    target: ball,
                    direction: {
                        x: dx / distance,
                        y: dy / distance
                    }
                };
            }
        }

        if (!best) return { direction, target: null };

        const blend = 0.78;
        const x = direction.x * (1 - blend) + best.direction.x * blend;
        const y = direction.y * (1 - blend) + best.direction.y * blend;
        const length = Math.max(1, Math.hypot(x, y));

        return {
            direction: { x: x / length, y: y / length },
            target: best.target
        };
    }

    autoShoot() {
        if (!this.mainBall || !this.awaitingShot) return;

        const liveTargets = this.balls.filter((ball) => !ball.isMainBall && !ball.eliminated);
        const target = this.phase === 'QUALIFICATION'
            ? {
                x: this.canvas.width / 2 + (Math.random() - 0.5) * this.squareSize,
                y: this.qualTargetY + (Math.random() - 0.35) * 90
            }
            : liveTargets.length
                ? liveTargets[Math.floor(Math.random() * liveTargets.length)]
                : { x: this.canvas.width / 2, y: this.squareTop };
        const spread = this.phase === 'QUALIFICATION' ? 80 : 28;
        const dx = target.x + (Math.random() - 0.5) * spread - this.mainBall.x;
        const dy = target.y + (Math.random() - 0.5) * spread - this.mainBall.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        this.shootDirection = { x: dx / distance, y: dy / distance };
        this.shootPower = this.phase === 'QUALIFICATION' ? 0.78 : 1;
        this.shootMainBall();
    }

    toggleMode() {
        this.mode = this.mode === 'DEMO' ? 'MANUAL' : 'DEMO';
        this.clearShootTimeout();

        if (this.mode === 'DEMO') {
            if (this.phase === 'MISE') {
                this.shootTimeout = setTimeout(() => this.startQualificationPhase(), 700);
            } else if (this.awaitingShot) {
                this.shootTimeout = setTimeout(() => this.autoShoot(), 500);
            }
        }
        this.updateUI();
    }

    updatePhysics() {
        for (const ball of this.balls) {
            if (!ball.eliminated) {
                ball.update(this.config.friction);
                ball.checkBounds(this.canvas.width, this.canvas.height);
            }
        }

        for (let i = 0; i < this.balls.length; i++) {
            for (let j = i + 1; j < this.balls.length; j++) {
                this.resolveCollision(this.balls[i], this.balls[j]);
            }
        }

        this.checkEjections();
        this.checkTurnEnd();
    }

    resolveCollision(a, b) {
        if (a.eliminated || b.eliminated) return;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const minDistance = a.radius + b.radius + 3;
        if (distance <= 0 || distance >= minDistance) return;

        const nx = dx / distance;
        const ny = dy / distance;
        const relativeVx = a.vx - b.vx;
        const relativeVy = a.vy - b.vy;
        const speed = relativeVx * nx + relativeVy * ny;

        const overlap = (minDistance - distance) / 2 + 0.2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        if (speed <= 0) return;

        const impulse = speed * this.config.collisionDamping;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;

        this.applyArcadeHitBoost(a, b, nx, ny, speed);
    }

    applyArcadeHitBoost(a, b, nx, ny, speed) {
        if (this.phase !== 'TIR' || speed < 1.2) return;

        const main = a.isMainBall ? a : b.isMainBall ? b : null;
        const target = a.isMainBall ? b : b.isMainBall ? a : null;
        if (!main || !target || target.eliminated) return;

        const centerX = this.squareLeft + this.squareSize / 2;
        const centerY = this.squareTop + this.squareSize / 2;
        const outX = target.x - centerX;
        const outY = target.y - centerY;
        const outLength = Math.max(1, Math.hypot(outX, outY));
        const collisionX = target === b ? nx : -nx;
        const collisionY = target === b ? ny : -ny;
        const boost = Math.min(7.5, this.config.hitBoost + speed * 0.28);

        target.vx += (outX / outLength) * boost + collisionX * 1.2;
        target.vy += (outY / outLength) * boost + collisionY * 1.2;
        main.vx *= 0.72;
        main.vy *= 0.72;
    }

    checkEjections() {
        if (this.phase !== 'TIR') return;

        const player = this.players[this.currentPlayerIndex];
        for (const ball of this.balls) {
            if (ball.isMainBall || ball.eliminated) continue;

            const margin = ball.radius * 0.35;
            const inside = ball.x >= this.squareLeft + margin &&
                ball.x <= this.squareRight - margin &&
                ball.y >= this.squareTop + margin &&
                ball.y <= this.squareBottom - margin;

            if (!inside && ball.inSquare) {
                ball.eliminated = true;
                ball.inSquare = false;
                ball.wonByPlayerId = player.id;
                this.scores[player.id] += 1;
                this.currentTurnEjectedBall = true;
                this.lastEvent = `${player.name} gagne une bille et rejoue.`;
                setTimeout(() => {
                    this.lastEvent = '';
                }, 1800);
            } else if (inside) {
                ball.inSquare = true;
            }
        }
    }

    checkTurnEnd() {
        if (this.awaitingShot || this.turnEndScheduled) return;
        if (this.phase !== 'QUALIFICATION' && this.phase !== 'TIR') return;
        if (!this.balls.every((ball) => ball.eliminated || !ball.isMoving())) return;

        this.turnEndScheduled = true;
        setTimeout(() => {
            if (!this.balls.every((ball) => ball.eliminated || !ball.isMoving())) {
                this.turnEndScheduled = false;
                return;
            }

            this.turnEndScheduled = false;
            if (this.phase === 'QUALIFICATION') {
                this.finishQualificationShot();
            } else if (this.phase === 'TIR') {
                this.finishTirShot();
            }
        }, 650);
    }

    finishQualificationShot() {
        const player = this.players[this.currentPlayerIndex];
        const finalY = this.mainBall ? this.mainBall.y : this.shootLineY;
        const distance = Math.abs(finalY - this.qualTargetY);
        const crossed = finalY < this.qualTargetY;
        this.qualificationResults[player.id] = {
            playerId: player.id,
            finalY,
            distance,
            crossed,
            bounceCount: this.mainBall ? this.mainBall.bounceCount : 0,
            maxZ: this.mainBall ? this.mainBall.maxZ : 0
        };
        this.currentPlayerIndex++;

        if (this.currentPlayerIndex >= this.players.length) {
            this.applyQualificationOrder();
            this.startTirPhase();
        } else {
            this.spawnMainBall();
        }
    }

    applyQualificationOrder() {
        this.qualificationOrder = Object.values(this.qualificationResults).sort((a, b) => {
            if (a.crossed !== b.crossed) return a.crossed ? 1 : -1;
            if (a.distance !== b.distance) return a.distance - b.distance;
            if (a.bounceCount !== b.bounceCount) return a.bounceCount - b.bounceCount;
            if (a.maxZ !== b.maxZ) return a.maxZ - b.maxZ;
            return a.playerId - b.playerId;
        });

        const orderById = new Map(this.qualificationOrder.map((result, index) => [result.playerId, index]));
        this.players.sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
        this.currentPlayerIndex = 0;

        const first = this.players[0];
        const lastCrossed = this.qualificationOrder.filter((result) => result.crossed).map((result) => `J${result.playerId}`);
        this.lastEvent = lastCrossed.length
            ? `Ordre fixe: ${first.name} commence. Ligne franchie: ${lastCrossed.join(', ')} en dernier.`
            : `Ordre fixe: ${first.name} commence.`;
        setTimeout(() => {
            this.lastEvent = '';
        }, 3200);
    }

    finishTirShot() {
        const remaining = this.balls.filter((ball) => !ball.isMainBall && !ball.eliminated).length;
        if (remaining === 0) {
            this.endGame();
            return;
        }

        if (!this.currentTurnEjectedBall) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        }
        this.spawnMainBall();
    }

    endGame() {
        this.phase = 'GAME_OVER';
        this.awaitingShot = false;
        this.balls = this.balls.filter((ball) => !ball.isMainBall);
        const winner = this.getWinner();
        this.showStatus(`${winner.name} gagne la partie avec ${this.scores[winner.id]} point(s).`);
    }

    getWinner() {
        return this.players.reduce((best, player) => {
            if (!best || this.scores[player.id] > this.scores[best.id]) return player;
            return best;
        }, null);
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGround();
        this.drawGameAreas();

        for (const ball of this.balls) {
            ball.draw(this.ctx);
        }

        this.drawWonBalls();
        if (this.mainBall && this.shootDirection && this.awaitingShot) {
            this.drawShootingGuide();
        }

        this.updateUI();
    }

    drawGround() {
        const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, '#0f2f22');
        gradient.addColorStop(0.48, '#16351d');
        gradient.addColorStop(1, '#101820');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
        this.ctx.lineWidth = 1;
        for (let x = 0; x < this.canvas.width; x += 44) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        for (let y = 0; y < this.canvas.height; y += 44) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }

    drawGameAreas() {
        this.ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
        this.ctx.fillRect(this.squareLeft, this.squareTop, this.squareSize, this.squareSize);
        this.ctx.strokeStyle = '#f97316';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(this.squareLeft, this.squareTop, this.squareSize, this.squareSize);

        this.ctx.fillStyle = '#fed7aa';
        this.ctx.font = '700 13px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('CARRE DE MISE', this.squareLeft + this.squareSize / 2, this.squareTop - 10);

        this.ctx.strokeStyle = '#22c55e';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([7, 7]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.qualLineX1, this.qualLineY1);
        this.ctx.lineTo(this.qualLineX1, this.qualLineY2);
        this.ctx.moveTo(this.qualLineX2, this.qualLineY1);
        this.ctx.lineTo(this.qualLineX2, this.qualLineY2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.strokeStyle = '#86efac';
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([12, 7]);
        this.ctx.beginPath();
        this.ctx.moveTo(this.squareLeft - this.squareSize * 0.55, this.qualTargetY);
        this.ctx.lineTo(this.squareRight + this.squareSize * 0.55, this.qualTargetY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = '#bbf7d0';
        this.ctx.font = '700 12px Arial';
        this.ctx.fillText('LIGNE QUALIF', this.squareLeft + this.squareSize / 2, this.qualTargetY - 9);

        this.ctx.strokeStyle = '#60a5fa';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.shootLineY);
        this.ctx.lineTo(this.canvas.width, this.shootLineY);
        this.ctx.stroke();

        this.ctx.fillStyle = '#bfdbfe';
        this.ctx.font = '700 12px Arial';
        this.ctx.fillText('LIGNE DE TIR', this.canvas.width / 2, this.shootLineY + 22);

        this.ctx.fillStyle = 'rgba(3, 7, 18, 0.45)';
        this.ctx.fillRect(this.wonBallsArea.x, this.wonBallsArea.y, this.wonBallsArea.width, this.wonBallsArea.height);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(this.wonBallsArea.x, this.wonBallsArea.y, this.wonBallsArea.width, this.wonBallsArea.height);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '700 11px Arial';
        this.ctx.fillText('GAGNEES', this.wonBallsArea.x + this.wonBallsArea.width / 2, this.wonBallsArea.y + 19);
        this.ctx.textAlign = 'left';
    }

    drawShootingGuide() {
        const startX = this.mainBall.x;
        const startY = this.mainBall.y;
        const length = 70 + this.shootPower * 170;

        this.ctx.strokeStyle = `rgba(250, 204, 21, ${0.45 + this.shootPower * 0.45})`;
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([9, 7]);
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(startX + this.shootDirection.x * length, startY + this.shootDirection.y * length);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.fillStyle = '#facc15';
        this.ctx.fillRect(startX - 34, startY - 42, 68 * this.shootPower, 8);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.strokeRect(startX - 34, startY - 42, 68, 8);

        if (this.aimAssistTarget) {
            this.ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.arc(this.aimAssistTarget.x, this.aimAssistTarget.y, this.aimAssistTarget.radius + 8, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
    }

    drawWonBalls() {
        const grouped = new Map(this.players.map((player) => [player.id, 0]));
        for (const ball of this.balls) {
            if (ball.eliminated && ball.wonByPlayerId) {
                grouped.set(ball.wonByPlayerId, grouped.get(ball.wonByPlayerId) + 1);
            }
        }

        let y = this.wonBallsArea.y + 40;
        for (const player of this.players) {
            const count = grouped.get(player.id) || 0;
            if (!count) continue;

            this.ctx.fillStyle = player.color;
            this.ctx.font = '700 11px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(player.name.replace('Joueur ', 'J'), this.wonBallsArea.x + this.wonBallsArea.width / 2, y);
            y += 13;

            for (let i = 0; i < count; i++) {
                const x = this.wonBallsArea.x + 22 + (i % 4) * 17;
                const rowY = y + Math.floor(i / 4) * 17;
                const displayBall = new Ball(x, rowY, 6, player.color);
                displayBall.draw(this.ctx);
            }
            y += Math.ceil(count / 4) * 17 + 14;
        }
        this.ctx.textAlign = 'left';
    }

    updateUI() {
        const phaseNames = {
            SETUP: 'Configuration',
            MISE: 'Mise',
            QUALIFICATION: 'Qualification',
            TIR: 'Tir',
            GAME_OVER: 'Partie terminee'
        };
        const currentPlayer = this.players[this.currentPlayerIndex] || this.players[0];
        const totalStakeBalls = this.balls.filter((ball) => !ball.isMainBall).length;
        const eliminatedBalls = this.balls.filter((ball) => !ball.isMainBall && ball.eliminated).length;

        this.setText('phase', phaseNames[this.phase] || this.phase);
        this.setText('round', this.round);
        this.setText('gameMode', this.mode === 'DEMO' ? 'Demo' : 'Manuel');
        this.setText('currentPlayer', currentPlayer ? currentPlayer.name : '-');
        this.setText('playerCountDisplay', this.numPlayers);
        this.setText('stakeCountDisplay', this.stakePerPlayer);
        this.setText('billesTotales', Math.max(0, totalStakeBalls - eliminatedBalls));
        this.setText('billesEjectees', eliminatedBalls);

        const currentEl = document.getElementById('currentPlayer');
        if (currentEl && currentPlayer) currentEl.style.color = currentPlayer.color;

        document.getElementById('scoresContainer').innerHTML = this.players.map((player) => `
            <div class="score-row" style="border-left-color: ${player.color}">
                <span class="score-name">${player.name}</span>
                <span class="score-value">${this.scores[player.id] || 0} pt</span>
            </div>
        `).join('');

        const status = this.lastEvent || this.getStatusText();
        this.setText('statusText', status);
    }

    getStatusText() {
        const player = this.players[this.currentPlayerIndex] || this.players[0];
        if (this.phase === 'MISE') return this.mode === 'DEMO' ? 'La demo va commencer.' : 'Cliquez pour lancer la qualification.';
        if (this.phase === 'QUALIFICATION') return `${player.name}: arretez la bille au plus pres de la ligne verte sans la franchir.`;
        if (this.phase === 'TIR') return `${player.name}: visez une bille, le cercle vert aide le contact.`;
        if (this.phase === 'GAME_OVER') {
            const winner = this.getWinner();
            return `${winner.name} gagne avec ${this.scores[winner.id]} point(s).`;
        }
        return 'Pret.';
    }

    setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = value;
    }

    showStatus(message) {
        this.lastEvent = message;
        this.updateUI();
    }

    gameLoop() {
        this.updatePhysics();
        this.draw();
        requestAnimationFrame(() => this.gameLoop());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.gameEngine = new GameEngine();
});
