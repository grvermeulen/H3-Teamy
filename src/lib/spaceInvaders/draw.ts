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

export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
): void {
  ctx.save();
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < GAME_W; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, GAME_H);
    ctx.stroke();
  }

  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      const rect = alienRect(state, r, c);
      if (!rect) continue;
      const hue = 100 + r * 18;
      ctx.fillStyle = `hsl(${hue} 70% 55%)`;
      ctx.fillRect(rect.left, rect.top, ALIEN_W, ALIEN_H);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(rect.left + 6, rect.top + 4, 8, 6);
      ctx.fillRect(rect.left + ALIEN_W - 14, rect.top + 4, 8, 6);
    }
  }

  const px = state.playerX - PLAYER_W / 2;
  ctx.fillStyle = "#58a6ff";
  ctx.beginPath();
  ctx.moveTo(state.playerX, PLAYER_Y);
  ctx.lineTo(px + PLAYER_W, PLAYER_Y + PLAYER_H);
  ctx.lineTo(px, PLAYER_Y + PLAYER_H);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#3fb950";
  for (const b of state.playerBullets) {
    ctx.fillRect(b.x - BULLET_W / 2, b.y - BULLET_H, BULLET_W, BULLET_H);
  }

  ctx.fillStyle = "#f85149";
  for (const b of state.alienBullets) {
    ctx.fillRect(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H);
  }

  if (state.status === "paused") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
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
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.fillStyle = "#f85149";
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Game over", GAME_W / 2, GAME_H / 2 - 24);
    ctx.fillStyle = "#f0f6fc";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(`Score: ${state.score}`, GAME_W / 2, GAME_H / 2 + 8);
    ctx.fillStyle = "#8b949e";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Herstart of sluit", GAME_W / 2, GAME_H / 2 + 36);
  }

  ctx.restore();
}
