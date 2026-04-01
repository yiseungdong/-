// ═══════════════════════════════════════════════════════
// avatar-renderer.js — 아스테리아 아바타 공통 렌더러
// 모든 페이지가 이 파일을 통해 동일한 아바타를 그린다
// ═══════════════════════════════════════════════════════

function renderAvatarToEl(elementId, options) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (typeof getBaseSVG !== 'function') return;
  const base = localStorage.getItem('asteria_avatar_base') || 'm1';
  const opt = Object.assign({
    width: 200, height: 250, scale: 0.32, topOffset: '-20%'
  }, options);
  el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.innerHTML =
    '<div style="position:absolute;width:' + opt.width + 'px;height:' + opt.height + 'px;top:50%;left:50%;transform:translate(-50%,' + opt.topOffset + ') scale(' + opt.scale + ');transform-origin:center top;">' + getBaseSVG(base) + '</div>';
}

function initAvatarSync(targets) {
  targets.forEach(function(t) { renderAvatarToEl(t.id, t.options); });
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel('asteria_avatar_sync');
    ch.onmessage = function(e) {
      if (e.data && e.data.type === 'AVATAR_UPDATED') {
        targets.forEach(function(t) { renderAvatarToEl(t.id, t.options); });
      }
    };
  }
}
