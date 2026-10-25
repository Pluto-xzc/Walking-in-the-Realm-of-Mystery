/**
 * UI 功能组：result
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { IDENTITY_COLOR, IDENTITY_LABEL } from '../match.js';
import { $, el } from '../ui-helpers.js';

export default {

/* ---------------- 结算界面 ---------------- */
showResult(game) {
  return new Promise((resolve) => {
    const modal = $('#sgs-result-modal');
    modal.classList.add('active');
    const box = $('.sgs-modal-box', modal);
    box.innerHTML = '';

    const me = game.players.find((p) => p.isHuman);
    const win = game.winner === me.identity
      || (game.winner === 'zhu' && (me.identity === 'zhu' || me.identity === 'zhong'))
      || (game.winner === 'fan' && me.identity === 'fan');

    const title = el('div', `sgs-result-big ${win ? 'win' : 'lose'}`, win ? '胜 利' : '失 败');
    box.appendChild(title);

    const winnerNames = { zhu: '主公方', fan: '反贼方', nei: '内奸', draw: '平局' };
    box.appendChild(el('div', 'sgs-result-sub',
      `${winnerNames[game.winner] || game.winner} 获胜 · 共 ${game.turnCount} 回合`));

    // 玩家列表
    const list = el('div', 'sgs-result-list');
    game.players.forEach((p) => {
      const row = el('div', 'sgs-result-row');
      if (p.isHuman) row.classList.add('me');
      row.appendChild(el('span', 'rname', p.name + (p.isHuman ? '（你）' : '')));
      const id = el('span', 'rid', IDENTITY_LABEL[p.identity]);
      id.style.background = IDENTITY_COLOR[p.identity];
      row.appendChild(id);
      row.appendChild(el('span', 'rstate',
        p.alive ? `存活 · 体力 ${p.hp}/${p.maxHp}` : '已阵亡'));
      list.appendChild(row);
    });
    box.appendChild(list);

    const btnWrap = el('div', '', '');
    btnWrap.style.cssText = 'display:flex;justify-content:center;gap:12px;';
    const again = el('button', 'sgs-act-btn primary', '再来一局');
    again.style.padding = '10px 34px';
    again.onclick = () => location.reload();
    btnWrap.appendChild(again);
    box.appendChild(btnWrap);

    resolve();
  });
}
};
