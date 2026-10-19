// ==UserScript==
// @name         批改网 pigai 解除粘贴限制 + 用时上报改写
// @namespace    https://local.explore/pigai-unblock-paste
// @version      1.1.0
// @description  解除批改网（pigai.org）作文正文框的粘贴拦截；顺手改写「输入总时长」上报值（按字数随机出一个合理时长），让自动保存/提交带上去的 time 不再等于真实盯着屏幕的时间
// @author       YG
// @match        https://www.pigai.org/*
// @match        http://www.pigai.org/*
// @match        https://pigai.org/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 一、粘贴拦截（原始需求）
 * ------------------------
 * 站点拦粘贴的常见写法：在 textarea / document 上挂 paste 监听，里面 preventDefault()
 * 或者干脆弹提示。事件流是 window → ... → target，所以只要在 window 的捕获阶段
 * 用 stopImmediatePropagation() 把事件截住，页面的处理函数就永远收不到这个事件。
 *
 * 关键点：只 stopPropagation，不 preventDefault。浏览器的默认动作（把剪贴板内容
 * 塞进焦点元素）跟事件传播无关，所以粘贴照常发生。
 *
 * 兜底：Alt+V。不依赖任何事件，直接 navigator.clipboard.readText() 拿文本，
 * 用 setRangeText / execCommand('insertText') 写进去，再补一个 input 事件让
 * 页面的字数统计、自动保存能感知到。
 *
 * 二、用时上报改写（后加）
 * ------------------------
 * 站点侧的实现（spss.js）：
 *     function saveData2(){
 *         cdata.content = encodeURIComponent($('#contents').val());
 *         cdata.rid = _rid;
 *         cdata.time = _c_time / 1000;              // ← 用时，单位秒
 *         $.post(_self+"?c=ajax&a=saveCaogao2", cdata, ...);
 *     }
 *     function clock_init(){ _c_time += 1000; ... }  // 每秒 +1s，页面顶部「用时」就是它
 * 触发时机：每次点「保存数据」、以及 clock_init 每 210 秒自动调一次 saveData()。
 * 提交（?c=ajax&a=postSave）本身不带 time，服务端记的是最后一次 saveCaogao2 的值；
 * 而且刷新页面后服务端会把这个值重新塞回 _c_time —— 已实测（把 time 改成 1472，
 * 刷新后 _c_time=1482，即 1472s + 刷新耗时）。
 *
 * 所以这里的做法：在 XHR 发出前把 body 里的 time= 换成本脚本算出来的值。
 * 算法：字数 / 随机打字速度（默认 8~14 词/分钟，含思考停顿）× 60，再叠 ±8% 抖动。
 * 352 词的作文落在 25~44 分钟，看上去就是个老老实实手打的学生。
 *
 * 两个可调开关见 CFG 里的 capToElapsed / syncDisplay。
 */

(function () {
  'use strict';

  const CFG = {
    // —— 粘贴 ——
    unblockPaste: true,        // 放行 paste 事件（核心）
    unblockPasteKey: true,     // 放行 Ctrl/Cmd+V 的 keydown
    unblockContextMenu: true,  // 放开右键菜单（很多站点一并禁掉了）
    stripInlineHandlers: true, // 清掉元素上的 onpaste / oncontextmenu 内联属性
    altVPaste: true,           // Alt+V 兜底粘贴

    // —— 用时上报 ——
    spoofTime: true,           // 总开关：改写 time= 上报值
    wpmMin: 8,                 // 随机打字速度下限（词/分钟）
    wpmMax: 14,                // 上限
    jitter: 0.08,              // 额外 ±8% 抖动，避免每次算出来都规规矩矩
    matchUrls: /a=(saveCaogao2|postSave)/, // 只改这两个接口
    capToElapsed: false,       // true = 取 min(算出值, 真实已用时)，防止「声称的时间比本页停留还长」
    syncDisplay: false,        // true = 连页面顶部显示的「用时」一起改成同量级（会看到计时条回跳）

    debug: true,               // 控制台打日志
  };

  const log = (...a) => CFG.debug && console.info('%c[pigai-unblock]', 'color:#0aa', ...a);

  /* ---------- 1. 捕获阶段截断事件，但不取消默认行为 ---------- */

  const swallow = (e) => {
    // 只挡传播，不挡默认动作
    e.stopImmediatePropagation();
  };

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'v') {
      // Ctrl+V / Ctrl+Shift+V（纯文本粘贴）都放行
      e.stopImmediatePropagation();
      log('放行 Ctrl+V');
    }
  };

  if (CFG.unblockPaste) {
    // 用 window 的捕获阶段，抢在页面任何监听器之前（@run-at document-start 保证了顺序）
    window.addEventListener('paste', swallow, true);
    window.addEventListener('beforepaste', swallow, true);
  }

  if (CFG.unblockPasteKey) {
    window.addEventListener('keydown', onKeyDown, true);
  }

  if (CFG.unblockContextMenu) {
    window.addEventListener('contextmenu', swallow, true);
  }

  /* ---------- 2. 清掉内联属性 & 后续动态插入的元素 ---------- */

  const ATTRS = ['onpaste', 'onbeforepaste', 'oncontextmenu'];

  function clean(el) {
    if (!el || el.nodeType !== 1) return;
    for (const a of ATTRS) {
      if (el.hasAttribute && el.hasAttribute(a)) el.removeAttribute(a);
    }
  }

  function cleanTree(root) {
    clean(root);
    if (root.querySelectorAll) {
      root.querySelectorAll('textarea,input,[contenteditable],body,iframe')
        .forEach(clean);
    }
  }

  if (CFG.stripInlineHandlers) {
    const boot = () => {
      cleanTree(document);
      const mo = new MutationObserver((recs) => {
        for (const r of recs) {
          if (r.type === 'attributes') clean(r.target);
          r.addedNodes && r.addedNodes.forEach(cleanTree);
        }
      });
      mo.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ATTRS,
      });
      log('已清理内联拦截属性');
    };

    if (document.documentElement) boot();
    else document.addEventListener('readystatechange', boot, { once: true });
  }

  /* ---------- 3. 兜底：Alt+V 用剪贴板 API 直接写入 ---------- */

  function toast(msg) {
    let t = document.getElementById('__pigai_unblock_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '__pigai_unblock_toast';
      t.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
        'padding:8px 14px', 'border-radius:6px', 'background:#222', 'color:#fff',
        'font:13px/1.6 system-ui,sans-serif', 'opacity:.92', 'pointer-events:none',
        'transition:opacity .3s',
      ].join(';');
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '.92';
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => { t.style.opacity = '0'; }, 1600);
  }

  function insertText(text) {
    const el = document.activeElement;
    if (!el) return false;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      if (typeof el.setRangeText === 'function') {
        el.setRangeText(text, start, end, 'end');
      } else {
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
      }
      // 让页面的字数统计 / 自动保存 / 脏检查能感知
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (el.isContentEditable) {
      const ok = document.execCommand('insertText', false, text);
      if (!ok) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0);
          r.deleteContents();
          r.insertNode(document.createTextNode(text));
          sel.collapseToEnd();
        }
      }
      return true;
    }
    return false;
  }

  if (CFG.altVPaste) {
    window.addEventListener('keydown', async (e) => {
      if (!(e.altKey && !e.ctrlKey && !e.metaKey)) return;
      if ((e.key || '').toLowerCase() !== 'v') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return toast('剪贴板是空的');
        if (insertText(text)) {
          log('Alt+V 写入', text.length, '字符');
          toast(`已插入 ${text.length} 字符`);
        } else {
          toast('先把光标放进正文框再按 Alt+V');
        }
      } catch (err) {
        // Firefox 可能要在权限弹窗里允许读取剪贴板
        toast('读取剪贴板被拒，请在弹窗里允许');
        log('clipboard.readText 失败', err);
      }
    }, true);
  }

  /* ---------- 4. 用时上报改写 ---------- */

  // 只数英文/数字词，跟站点 #couti 的口径基本一致（352 词那篇它算 352）
  const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’\-]*/g;

  function countWords(text) {
    const m = String(text || '').trim().match(WORD_RE);
    return m ? m.length : 0;
  }

  function essayWords() {
    const el = document.getElementById('contents')
      || document.querySelector('textarea[name="contents"]');
    return countWords(el && el.value);
  }

  function pickedSeconds(words) {
    const w = words > 0 ? words : 300;                      // 还没填内容时按 300 词下限估
    const wpm = CFG.wpmMin + Math.random() * (CFG.wpmMax - CFG.wpmMin);
    let sec = (w * 60) / wpm;
    sec *= 1 + (Math.random() * 2 - 1) * CFG.jitter;        // ±jitter 抖动
    sec = Math.max(60, Math.round(sec));
    if (CFG.capToElapsed && typeof window._c_time === 'number') {
      const real = Math.round(window._c_time / 1000);
      if (real > 0) sec = Math.min(sec, real);
    }
    return sec;
  }

  function stampTime(body) {
    const words = essayWords();
    const sec = pickedSeconds(words);
    let out = body;

    if (typeof body === 'string') {
      out = /(^|&)time=/.test(body)
        ? body.replace(/(^|&)time=[^&]*/, `$1time=${sec}`)
        : body + (body && !body.endsWith('&') ? '&' : '') + `time=${sec}`;
    } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      body.set('time', String(sec));
    } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
      body.set('time', String(sec));
    } else {
      return body;                                          // 二进制 / null，原样放行
    }

    log(`用时改写：${words} 词 → ${sec}s（${(sec / 60).toFixed(1)} 分钟）`);
    return out;
  }

  if (CFG.spoofTime) {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__pgUrl = String(url || '');
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (CFG.matchUrls.test(this.__pgUrl || '')) body = stampTime(body);
      } catch (err) {
        log('XHR 改写失败', err);
      }
      return origSend.call(this, body);
    };

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (CFG.matchUrls.test(url) && init && init.body != null) {
            init.body = stampTime(init.body);
          }
        } catch (err) {
          log('fetch 改写失败', err);
        }
        return origFetch.apply(this, arguments);
      };
    }

    if (CFG.syncDisplay) {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
          if (typeof window._c_time !== 'number') return;
          const sec = pickedSeconds(essayWords());
          window._c_time = sec * 1000;
          log(`页面「用时」重置为 ${sec}s`);
        }, 1500);
      }, { once: true });
    }
  }

  log('已启用：Ctrl+V 放行 / 右键放开 / Alt+V 兜底 / 用时改写');
})();
