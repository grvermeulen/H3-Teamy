import {
  ALIEN_COLS,
  ALIEN_H,
  ALIEN_ROWS,
  ALIEN_W,
  BULLET_H,
  BULLET_W,
  GAME_H,
  GAME_W,
  PLAYER_H,
  PLAYER_W,
  PLAYER_Y,
} from "./constants";
import { alienRect } from "./game";
import type { GameState } from "./types";

function drawStarfield(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.save();
  for (let i = 0; i < 48; i++) {
    const sx = ((i * 73) % GAME_W) + Math.sin(t * 0.4 + i) * 2;
    const sy = ((i * 47) % GAME_H) + ((t * 12 + i * 17) % GAME_H);
    const tw = 0.5 + (i % 3) * 0.35;
    const a = 0.15 + (i % 5) * 0.08;
    ctx.fillStyle = `rgba(200,220,255,${a})`;
    ctx.fillRect(sx % GAME_W, sy, tw, tw);
  }
  ctx.restore();
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  timeSec = 0,
): void {
  ctx.save();

  const g = ctx.createLinearGradient(0, 0, 0, GAME_H);
  g.addColorStop(0, "#0a1628");
  g.addColorStop(0.45, "#0d1520");
  g.addColorStop(1, "#050810");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  drawStarfield(ctx, timeSec);

  ctx.strokeStyle = "rgba(100,180,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x < GAME_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, GAME_H);
    ctx.stroke();
  }

  // Loot drops (glow)
  for (const d of state.lootDrops) {
    const pulse = 0.65 + Math.sin(d.phase) * 0.25;
    let hue = 48;
    let label = "W";
    if (d.kind === "shield") {
      hue = 200;
      label = "S";
    } else if (d.kind === "burst") {
      hue = 32;
      label = "★";
    }
    ctx.shadowColor = `hsl(${hue} 90% 55%)`;
    ctx.shadowBlur = 14 * pulse;
    ctx.fillStyle = `hsla(${hue} 85% 52%, ${0.85 * pulse})`;
    ctx.strokeStyle = `hsla(${hue} 100% 70%, ${0.9})`;
    ctx.lineWidth = 2;
    const s = 18;
    ctx.beginPath();
    const lx = d.x - s / 2;
    const ly = d.y - s / 2;
    const rad = 4;
    ctx.moveTo(lx + rad, ly);
    ctx.lineTo(lx + s - rad, ly);
    ctx.quadraticCurveTo(lx + s, ly, lx + s, ly + rad);
    ctx.lineTo(lx + s, ly + s - rad);
    ctx.quadraticCurveTo(lx + s, ly + s, lx + s - rad, ly + s);
    ctx.lineTo(lx + rad, ly + s);
    ctx.quadraticCurveTo(lx, ly + s, lx, ly + s - rad);
    ctx.lineTo(lx, ly + rad);
    ctx.quadraticCurveTo(lx, ly, lx + rad, ly);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, d.x, d.y + 0.5);
  }

  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      const rect = alienRect(state, r, c);
      if (!rect) continue;
      const hue = 105 + r * 20 + Math.sin(timeSec * 2 + c) * 4;
      ctx.shadowColor = `hsl(${hue} 80% 45%)`;
      ctx.shadowBlur = 8;
      const ag = ctx.createLinearGradient(
        rect.left,
        rect.top,
        rect.right,
        rect.bottom,
      );
      ag.addColorStop(0, `hsl(${hue} 72% 58%)`);
      ag.addColorStop(1, `hsl(${hue} 65% 38%)`);
      ctx.fillStyle = ag;
      ctx.fillRect(rect.left, rect.top, ALIEN_W, ALIEN_H);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(rect.left + 5, rect.top + 3, 7, 5);
      ctx.fillRect(rect.left + ALIEN_W - 12, rect.top + 3, 7, 5);
    }
  }

  // Shield bubble
  if (state.shieldCharges > 0) {
    const cx = state.playerX;
    const cy = PLAYER_Y + PLAYER_H / 2;
    const pulse = 0.55 + Math.sin(timeSec * 6) * 0.12;
    ctx.strokeStyle = `rgba(100,200,255,${0.35 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy - 2,
      26 + state.shieldCharges * 2,
      Math.PI * 1.1,
      Math.PI * 1.9,
    );
    ctx.stroke();
    ctx.strokeStyle = `rgba(160,230,255,${0.2 + pulse * 0.2})`;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, 22, 0, Math.PI * 2);
    ctx.stroke();
  }

  const px = state.playerX - PLAYER_W / 2;
  ctx.shadowColor = "#58a6ff";
  ctx.shadowBlur = 12;
  const pg = ctx.createLinearGradient(
    px,
    PLAYER_Y,
    px + PLAYER_W,
    PLAYER_Y + PLAYER_H,
  );
  pg.addColorStop(0, "#7cb9ff");
  pg.addColorStop(1, "#388bfd");
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.moveTo(state.playerX, PLAYER_Y);
  ctx.lineTo(px + PLAYER_W, PLAYER_Y + PLAYER_H);
  ctx.lineTo(px, PLAYER_Y + PLAYER_H);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  for (const b of state.playerBullets) {
    ctx.shadowColor = "#3fb950";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#7ee787";
    ctx.fillRect(b.x - BULLET_W / 2, b.y - BULLET_H, BULLET_W, BULLET_H);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(180,255,200,0.45)";
    ctx.fillRect(b.x - 1, b.y - BULLET_H - 4, 2, 5);
  }

  for (const b of state.alienBullets) {
    ctx.shadowColor = "#ff7b72";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#f85149";
    ctx.fillRect(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H);
    ctx.shadowBlur = 0;
  }

  for (const p of state.particles) {
    const a = Math.min(1, p.life / p.maxLife);
    ctx.fillStyle = `hsla(${p.hue} 90% 62%, ${a * 0.95})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
    ctx.fill();
  }

  if (state.status === "wave_clear") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#f0f6fc";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "#58a6ff";
    ctx.shadowBlur = 18;
    ctx.fillText(`Golf ${state.wave}`, GAME_W / 2, GAME_H / 2 - 14);
    ctx.shadowBlur = 0;
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillStyle = "#8b949e";
    ctx.fillText("Volgende golf…", GAME_W / 2, GAME_H / 2 + 18);
  }

  if (state.status === "paused") {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#f0f6fc";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Pauze", GAME_W / 2, GAME_H / 2 - 8);
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "#8b949e";
    ctx.fillText("Druk op hervatten of P", GAME_W / 2, GAME_H / 2 + 18);
  }

  if (state.status === "gameover") {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#f85149";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "#f85149";
    ctx.shadowBlur = 20;
    ctx.fillText("Game over", GAME_W / 2, GAME_H / 2 - 28);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f0f6fc";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(`Score: ${state.score}`, GAME_W / 2, GAME_H / 2 + 6);
    ctx.fillStyle = "#8b949e";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Herstart of sluit", GAME_W / 2, GAME_H / 2 + 34);
  }

  ctx.restore();
}
