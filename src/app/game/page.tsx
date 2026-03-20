"use client";

import { useEffect, useRef, useState } from "react";

interface Position {
  x: number;
  y: number;
}

interface Alien extends Position {
  alive: boolean;
  type: number;
}

interface Bullet extends Position {
  active: boolean;
}

interface AlienBullet extends Position {
  active: boolean;
}

interface Particle extends Position {
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export default function SpaceInvadersGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [gameOver, setGameOver] = useState(false);
  const [wave, setWave] = useState(1);
  const gameStateRef = useRef({
    player: { x: 0, y: 0, width: 40, height: 30 },
    aliens: [] as Alien[],
    bullets: [] as Bullet[],
    alienBullets: [] as AlienBullet[],
    particles: [] as Particle[],
    keys: { left: false, right: false, space: false },
    alienDirection: 1,
    alienSpeed: 1,
    lastAlienMove: 0,
    lastShot: 0,
    lastAlienShot: 0,
    animationFrame: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = Math.min(800, window.innerWidth - 32);
    canvas.height = 600;

    const state = gameStateRef.current;
    state.player.x = canvas.width / 2 - state.player.width / 2;
    state.player.y = canvas.height - 120;

    const initAliens = () => {
      state.aliens = [];
      const rows = 4 + Math.floor(wave / 3);
      const cols = 8 + Math.floor(wave / 2);
      const spacing = 60;
      const offsetX = (canvas.width - cols * spacing) / 2;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          state.aliens.push({
            x: offsetX + col * spacing,
            y: 50 + row * 50,
            alive: true,
            type: row % 3,
          });
        }
      }
      state.alienSpeed = 1 + wave * 0.3;
    };

    initAliens();

    const drawPlayer = () => {
      const p = state.player;
      ctx.save();

      ctx.shadowColor = "#00ffff";
      ctx.shadowBlur = 20;

      ctx.fillStyle = "#00ffff";
      ctx.beginPath();
      ctx.moveTo(p.x + p.width / 2, p.y);
      ctx.lineTo(p.x, p.y + p.height);
      ctx.lineTo(p.x + p.width, p.y + p.height);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#0088ff";
      ctx.fillRect(p.x + 5, p.y + p.height - 10, p.width - 10, 8);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(p.x + p.width / 2 - 2, p.y + 5, 4, 10);

      ctx.restore();
    };

    const drawAlien = (alien: Alien) => {
      const frame = Math.floor(state.animationFrame / 20) % 2;
      const colors = ["#ff00ff", "#ffff00", "#00ff00"];
      const color = colors[alien.type];

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;

      ctx.fillStyle = color;

      const bodyOffset = frame * 3;
      ctx.fillRect(alien.x + 10, alien.y + bodyOffset, 20, 20);

      ctx.fillRect(alien.x, alien.y + 10 + bodyOffset, 10, 10);
      ctx.fillRect(alien.x + 30, alien.y + 10 + bodyOffset, 10, 10);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(alien.x + 12, alien.y + 5 + bodyOffset, 6, 6);
      ctx.fillRect(alien.x + 22, alien.y + 5 + bodyOffset, 6, 6);

      const legY = alien.y + 25 + bodyOffset;
      ctx.fillStyle = color;
      if (frame === 0) {
        ctx.fillRect(alien.x + 5, legY, 4, 8);
        ctx.fillRect(alien.x + 31, legY, 4, 8);
      } else {
        ctx.fillRect(alien.x + 8, legY, 4, 8);
        ctx.fillRect(alien.x + 28, legY, 4, 8);
      }

      ctx.restore();
    };

    const drawBullet = (bullet: Bullet) => {
      ctx.save();
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bullet.x - 2, bullet.y, 4, 15);
      ctx.restore();
    };

    const drawAlienBullet = (bullet: AlienBullet) => {
      ctx.save();
      ctx.shadowColor = "#ff0000";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(bullet.x - 2, bullet.y, 4, 15);
      ctx.restore();
    };

    const drawParticle = (p: Particle) => {
      ctx.save();
      ctx.globalAlpha = p.life / 100;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
      ctx.restore();
    };

    const createExplosion = (x: number, y: number, color: string) => {
      for (let i = 0; i < 20; i++) {
        const angle = (Math.PI * 2 * i) / 20;
        const speed = 2 + Math.random() * 3;
        state.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 100,
          color,
        });
      }
    };

    const updateParticles = () => {
      state.particles = state.particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 2;
        return p.life > 0;
      });
    };

    const gameLoop = (timestamp: number) => {
      if (gameOver) return;

      ctx.fillStyle = "#000510";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < 100; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const brightness = Math.random();
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness * 0.5})`;
        ctx.fillRect(x, y, 1, 1);
      }

      state.animationFrame++;

      if (state.keys.left && state.player.x > 0) {
        state.player.x -= 5;
      }
      if (
        state.keys.right &&
        state.player.x < canvas.width - state.player.width
      ) {
        state.player.x += 5;
      }
      if (state.keys.space && timestamp - state.lastShot > 300) {
        state.bullets.push({
          x: state.player.x + state.player.width / 2,
          y: state.player.y,
          active: true,
        });
        state.lastShot = timestamp;
      }

      if (timestamp - state.lastAlienMove > 500 / state.alienSpeed) {
        let shouldMoveDown = false;
        for (const alien of state.aliens) {
          if (!alien.alive) continue;
          alien.x += state.alienDirection * 10;
          if (alien.x <= 0 || alien.x >= canvas.width - 40) {
            shouldMoveDown = true;
          }
        }
        if (shouldMoveDown) {
          state.alienDirection *= -1;
          for (const alien of state.aliens) {
            if (alien.alive) alien.y += 20;
          }
        }
        state.lastAlienMove = timestamp;
      }

      if (timestamp - state.lastAlienShot > 1000 - wave * 50) {
        const aliveAliens = state.aliens.filter((a) => a.alive);
        if (aliveAliens.length > 0) {
          const shooter =
            aliveAliens[Math.floor(Math.random() * aliveAliens.length)];
          state.alienBullets.push({
            x: shooter.x + 20,
            y: shooter.y + 30,
            active: true,
          });
          state.lastAlienShot = timestamp;
        }
      }

      state.bullets.forEach((bullet) => {
        bullet.y -= 8;
        if (bullet.y < 0) bullet.active = false;
      });

      state.alienBullets.forEach((bullet) => {
        bullet.y += 5;
        if (bullet.y > canvas.height) bullet.active = false;
      });

      state.bullets.forEach((bullet) => {
        state.aliens.forEach((alien) => {
          if (
            alien.alive &&
            bullet.active &&
            bullet.x > alien.x &&
            bullet.x < alien.x + 40 &&
            bullet.y > alien.y &&
            bullet.y < alien.y + 35
          ) {
            alien.alive = false;
            bullet.active = false;
            createExplosion(
              alien.x + 20,
              alien.y + 20,
              ["#ff00ff", "#ffff00", "#00ff00"][alien.type],
            );
            setScore((s) => s + 100 * (alien.type + 1));
          }
        });
      });

      state.alienBullets.forEach((bullet) => {
        if (
          bullet.active &&
          bullet.x > state.player.x &&
          bullet.x < state.player.x + state.player.width &&
          bullet.y > state.player.y &&
          bullet.y < state.player.y + state.player.height
        ) {
          bullet.active = false;
          createExplosion(
            state.player.x + state.player.width / 2,
            state.player.y + state.player.height / 2,
            "#00ffff",
          );
          setLives((l) => {
            const newLives = Math.max(0, l - 1);
            if (newLives <= 0) {
              setGameOver(true);
            }
            return newLives;
          });
        }
      });

      state.bullets = state.bullets.filter((b) => b.active);
      state.alienBullets = state.alienBullets.filter((b) => b.active);

      updateParticles();
      state.particles.forEach(drawParticle);

      state.aliens.forEach((alien) => {
        if (alien.alive) {
          drawAlien(alien);
          if (alien.y + 35 > state.player.y) {
            setGameOver(true);
          }
        }
      });

      state.bullets.forEach(drawBullet);
      state.alienBullets.forEach(drawAlienBullet);
      drawPlayer();

      if (state.aliens.every((a) => !a.alive)) {
        setWave((w) => w + 1);
        initAliens();
      }

      requestAnimationFrame(gameLoop);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") state.keys.left = true;
      if (e.key === "ArrowRight") state.keys.right = true;
      if (e.key === " ") {
        e.preventDefault();
        state.keys.space = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") state.keys.left = false;
      if (e.key === "ArrowRight") state.keys.right = false;
      if (e.key === " ") state.keys.space = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    requestAnimationFrame(gameLoop);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [gameOver, wave]);

  const restartGame = () => {
    setScore(0);
    setLives(3);
    setWave(1);
    setGameOver(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-black flex flex-col items-center justify-start pt-8 pb-32">
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 mb-2">
          Space Invaders
        </h1>
        <div className="flex gap-8 justify-center text-lg">
          <div className="text-cyan-400 font-mono">
            Score: <span className="text-white font-bold">{score}</span>
          </div>
          <div className="text-pink-400 font-mono">
            Lives:{" "}
            <span className="text-white font-bold">
              {"❤️".repeat(Math.max(0, lives))}
            </span>
          </div>
          <div className="text-purple-400 font-mono">
            Wave: <span className="text-white font-bold">{wave}</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="border-4 border-cyan-500 rounded-lg shadow-2xl shadow-cyan-500/50"
        />
        {gameOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 rounded-lg">
            <div className="text-center">
              <h2 className="text-5xl font-bold text-red-500 mb-4">
                GAME OVER
              </h2>
              <p className="text-2xl text-white mb-6">Final Score: {score}</p>
              <button
                onClick={restartGame}
                className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-bold text-xl rounded-lg hover:from-cyan-600 hover:to-purple-600 transition-all transform hover:scale-105"
              >
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 text-center space-y-2 text-gray-300 mb-24">
        <p className="text-sm">Use Arrow Keys ← → to move</p>
        <p className="text-sm">Press Space to shoot</p>
        <p className="text-xs text-gray-500 mt-4">
          Aliens get faster and more numerous each wave!
        </p>
      </div>
    </main>
  );
}
