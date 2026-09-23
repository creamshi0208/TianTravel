
/* 刷新 / 前进后退都不做滚动恢复：位置一律由下面的 route() 决定 */
if('scrollRestoration' in history){ history.scrollRestoration = 'manual'; }

var VIEW_CACHE = {};

function toggleView(id){
  document.querySelectorAll('.view').forEach(function(v){
    v.classList.toggle('on', v.getAttribute('data-view') === id);
  });
  document.documentElement.setAttribute('data-view', id);
}

function loadView(id, cb){
  var container = document.getElementById('v-' + id);
  if(!container){ toggleView('home'); if(cb) cb('home'); return 'home'; }
  if(id === 'home' || VIEW_CACHE[id]){
    toggleView(id);
    if(cb) cb(id);
    return id;
  }
  toggleView(id);
  container.classList.add('loading');
  fetch('views/' + id + '.html')
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); })
    .then(function(html){
      container.innerHTML = html;
      VIEW_CACHE[id] = true;
      container.classList.remove('loading');
      if(cb) cb(id);
    })
    .catch(function(err){
      container.classList.remove('loading');
      container.classList.add('load-error');
      console.error('Failed to load view: ' + id, err);
      if(cb) cb(id);
    });
  return id;
}
/* 瞬移（不做动画）。⚠️ 直接写 window.scrollTo(0, 0) 会「滑」过去：
   CSS 里 html{scroll-behavior:smooth} 同样作用于 JS 发起的滚动，于是切视图时
   变成一段约 350ms 的滚动过渡动画，表现就是「点开攻略后详情页滑进来」。
   必须显式要求 instant 才会瞬移。页内锚点（#sec-N）不经过这里，平滑跳转不受影响。 */
function scrollInstant(top){
  try{
    window.scrollTo({top:top, left:0, behavior:'instant'});
  }catch(err){
    /* 老浏览器不认识 instant：临时把 scroll-behavior 压成 auto 再滚。
       必须先强制一次样式重算，否则覆盖不会生效（实测踩过）。 */
    var r = document.documentElement;
    var prev = r.style.scrollBehavior;
    r.style.scrollBehavior = 'auto';
    void r.offsetHeight;
    window.scrollTo(0, top);
    r.style.scrollBehavior = prev;
  }
}
function jumpTop(){ scrollInstant(0); }
/* ===== 每个视图各自的标题 / 分享信息 =====
   <title> 和 og:* 在 head 里是写死的，只能描述首页。切进某篇攻略后不同步改写的话，
   分享出去、存书签、翻浏览器历史，显示的都还是「何田田的旅行攻略」，
   对方根本看不出是哪一篇。这里按当前视图实时改。
   注：og:image 故意没设 —— 单文件站点里图片是 data: URI，微信 / 微博 / Facebook
   的抓取器一律不认，设了也白设。真想要分享卡片带图，得把封面单独传到仓库里、
   给它一个 http 地址再来引。 */
var SITE = '何田田的旅行攻略';
var TAGLINE = '把路上的细节，留成可复用的路书';
function setMeta(sel, val){
  var el = document.querySelector(sel);
  if(el) el.setAttribute('content', val);
}
function applyMeta(target){
  var box = document.getElementById('v-' + target);
  var h1 = box ? box.querySelector('h1') : null;
  var title = (target === 'home' || !h1) ? SITE : (h1.textContent.trim() + ' · ' + SITE);
  var desc = TAGLINE;
  if(box && target !== 'home'){
    var spots = box.querySelector('.guide-hero .spots-line');
    var sub2 = box.querySelector('.guide-hero .sub2');
    var s = ((spots && spots.textContent) || (sub2 && sub2.textContent) || '').replace(/\s+/g, ' ').trim();
    if(s) desc = (h1 ? h1.textContent.trim() + '：' : '') + s;
  }
  if(desc.length > 100) desc = desc.slice(0, 99) + '…';
  document.title = title;
  setMeta('meta[name="description"]', desc);
  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:description"]', desc);
  setMeta('meta[property="og:url"]', location.href);
}

/* ===== 历史记录标记 =====
   给每条历史记录盖一个 __tt 戳，用来区分「点链接新压入的记录」和
   「前进/后退回到的旧记录」。VIEW.prev / VIEW.cur 记录进入当前这条记录
   前后各在看哪个视图。页面下方的「返回」按钮靠这三个值决定
   该真回退一步、还是把当前记录原地改写（见 goHome 的注释）。 */
var VIEW = {cur: null, prev: null, pushed: false};
function markEntry(initial){
  var st = history.state;
  var known = !!(st && st.__tt);      /* 盖过戳 → 是前进/后退回到的旧记录 */
  VIEW.pushed = !initial && !known;   /* 只有新压入的记录才算 pushed */
  if(!known){ try{ history.replaceState({__tt: 1}, ''); }catch(e){} }
}
/* 返回本次导航最终落在哪个视图。抽出来是为了 route() 能统一维护 VIEW.prev/cur，
   不用在每条 return 分支里各写一遍。 */
function inferView(sectionId){
  var views = ['nanchang-3d','anji-2d','xiangshan-3d'];
  for(var i=0;i<views.length;i++){ if(sectionId.indexOf(views[i])===0) return views[i]; }
  if(sectionId.indexOf('aj-')===0) return 'anji-2d';
  return null;
}

function afterViewReady(target){
  applyMeta(target);
  if(window.TOCbuild) window.TOCbuild();
}

function dispatch(initial){
  var raw = location.hash || '';
  if(raw !== '' && raw.indexOf('#/') !== 0){
    if(!initial){
      var cur = document.documentElement.getAttribute('data-view') || 'home';
      afterViewReady(cur);
      return cur;
    }
    var el = document.getElementById(raw.slice(1));
    var box = el && el.closest ? el.closest('.view') : null;
    if(box){
      var bv = box.getAttribute('data-view');
      loadView(bv, function(){
        var m = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        scrollInstant(Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - m));
        afterViewReady(bv);
      });
      return bv;
    }
    var inferred = inferView(raw.slice(1));
    if(inferred){
      loadView(inferred, function(){
        var tEl = document.getElementById(raw.slice(1));
        if(tEl){
          var mm = parseFloat(getComputedStyle(tEl).scrollMarginTop) || 0;
          scrollInstant(Math.max(0, tEl.getBoundingClientRect().top + window.pageYOffset - mm));
        } else { jumpTop(); }
        afterViewReady(inferred);
      });
      return inferred;
    }
    loadView('home', function(){ jumpTop(); afterViewReady('home'); });
    return 'home';
  }
  var target = raw.replace(/^#\/?/, '') || 'home';
  loadView(target, function(){ jumpTop(); afterViewReady(target); });
  return target;
}
function route(initial){
  markEntry(initial);
  var before = VIEW.cur;
  var target = dispatch(initial);
  VIEW.prev = (before === null ? target : before);
  VIEW.cur = target;
}
route(true);
window.addEventListener('hashchange', function(){ route(false); });

/* ===== 目录锚点：更新地址栏，但不新增历史记录 =====
   原来点目录是普通的 <a href="#sec-N">，每点一次就往历史栈里再压一条记录。
   于是一篇攻略可能在历史里留下好几条，点「返回」之后还能一路退回去。
   现在改成 replaceState：地址栏照常更新（方便复制分享当前章节），
   但不占历史栈 —— 一篇攻略在历史里最多只留一条记录。
   滚动自己来做，scroll-margin-top 会自动生效，章节标题不会被顶栏盖住。 */
document.addEventListener('click', function(e){
  if(!e.target.closest) return;
  /* Ctrl / ⌘ / Shift + 点击是想在新标签或新窗口打开，别拦 */
  if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  var a = e.target.closest('a[href^="#"]');
  if(!a) return;
  var h = a.getAttribute('href') || '';
  if(h === '#' || h.indexOf('#/') === 0) return;   /* 首页 / 返回按钮走正常路由 */
  var el = document.getElementById(h.slice(1));
  if(!el) return;
  e.preventDefault();
  try{ history.replaceState(history.state || {__tt: 1}, '', h); }
  catch(err){ location.hash = h.slice(1); }        /* 老浏览器兜底：退回原行为 */
  if(el.scrollIntoView) el.scrollIntoView({behavior: 'smooth', block: 'start'});
});

/* ===== 返回按钮：回到首页之后，不能再退回详情 =====
   原来是 <a href="#/">：点一下等于往历史栈里再压一条首页记录，
   详情那条还压在下面 —— 于是回到首页后按浏览器后退，又退回了刚才那篇详情，
   表现就是「明明点了返回，却还能退回去」。
   现在分两种情况：
   · 这条详情记录是新压进去的、而且是从首页点进来的 → history.back()，
     把详情这条记录真正弹出栈，首页后面就再也没有它了；
   · 否则（比如别人直接发来的详情链接，一进来就是详情、前面没有首页）
     → 用 location.replace 把当前这条详情记录原地改写成首页，
     详情同样消失，而且不会误退到站外去。 */
(function(){
  var backBtn = document.querySelector('.tb-back');
  if(!backBtn) return;
  backBtn.addEventListener('click', function(e){
    e.preventDefault();
    if(VIEW.pushed && VIEW.prev === 'home'){
      history.back();
    }else{
      location.replace('#/');
    }
  });
})();

/* ===== 回到顶部 + 阅读进度条 =====
   统一在一个 rAF 节流的滚动处理器里做（passive 监听，不改布局只改 class/transform）。
   之前 toTop 绑在 load 之后（base64 图全部解码完才生效）、直接切 display 会触发布局。 */
(function(){
  var b = document.getElementById('toTop'), prog = document.getElementById('prog');
  var ticking = false;
  /* rAF 降级：个别老内核/嵌入式浏览器没有就直接同步执行 */
  var raf = window.requestAnimationFrame || function(f){ f(); };
  function onScroll(){
    if(ticking) return;
    ticking = true;
    raf(function(){
      ticking = false;
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      if(b) b.classList.toggle('show', y > 600);
      if(prog){
        var h = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.transform = 'scaleX(' + (h > 40 ? Math.min(1, y / h) : 0) + ')';
      }
    });
  }
  window.addEventListener('scroll', onScroll, {passive: true});
  onScroll();
  if(b) b.addEventListener('click', function(){ window.scrollTo({top: 0, behavior: 'smooth'}); });
})();

/* ===== 表格横向滚动提示 =====
   能横滑且没滑到底时，右侧给一条内阴影（.tw.hint，见 CSS）暗示「往右还有内容」。 */
(function(){
  function hints(){
    document.querySelectorAll('.tw').forEach(function(t){
      var can = t.scrollWidth - t.clientWidth > 8;
      var end = t.scrollLeft + t.clientWidth >= t.scrollWidth - 8;
      t.classList.toggle('hint', can && !end);
    });
  }
  document.querySelectorAll('.tw').forEach(function(t){
    t.addEventListener('scroll', hints, {passive: true});
  });
  window.addEventListener('resize', hints);
  hints();
})();

/* ===== 图集灯箱：点击看大图，点任意处 / Esc 关闭 ===== */
(function(){
  var lb = document.getElementById('lb');
  if(!lb) return;
  var im = document.getElementById('lb-img');
  var cap = document.getElementById('lb-cap');
  function open(fig){
    var img = fig.querySelector('img');
    if(!img) return;
    im.src = img.src;
    var c = fig.querySelector('figcaption');
    cap.textContent = c ? c.textContent : '';
    lb.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function close(){
    lb.classList.remove('on');
    document.body.style.overflow = '';
  }
  document.addEventListener('click', function(e){
    if(!e.target.closest) return;
    var fig = e.target.closest('figure.ph');
    if(fig){ open(fig); return; }
    /* 灯箱内点任意处（含图片本身、关闭钮）都算关闭 */
    if(e.target.closest('#lb')) close();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' || e.keyCode === 27){
      if(lb.classList.contains('on')) close();
    }
  });
})();

/* ===== 分享按钮：点击直接复制链接（无弹窗） ===== */
(function(){
  var btn = document.getElementById('shareBtn');
  if(!btn) return;
  var original = btn.textContent;
  function showOk(){
    btn.textContent = '\u2713 \u5df2\u590d\u5236';
    setTimeout(function(){ btn.textContent = original; }, 1200);
  }
  function execCopy(url){
    var ta = document.createElement('textarea');
    ta.value = url; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showOk(); }catch(err){}
    document.body.removeChild(ta);
  }
  btn.addEventListener('click', function(e){
    e.preventDefault();
    var url = location.href;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(showOk).catch(function(){ execCopy(url); });
    } else { execCopy(url); }
  });
})();
var CUR = {p: '全部', c: '全部'};
function has(attr, val){ return (' ' + attr + ' ').indexOf(' ' + val + ' ') >= 0; }
function cards(){ return document.querySelectorAll('.gcard[data-prov]'); }
function applyFilter(){
  var shown = 0;
  cards().forEach(function(card){
    var okP = CUR.p === '全部' || has(card.getAttribute('data-prov') || '', CUR.p);
    var okC = CUR.c === '全部' || has(card.getAttribute('data-city') || '', CUR.c);
    var ok = okP && okC;
    card.style.display = ok ? '' : 'none';
    if(ok) shown++;
  });
  document.querySelectorAll('#fc button').forEach(function(b){
    var own = b.getAttribute('data-prov') || '全部';
    b.style.display = (CUR.p === '全部' || own === '全部' || own === CUR.p) ? '' : 'none';
  });
  var emp = document.getElementById('empty');
  if(emp) emp.style.display = shown ? 'none' : 'block';
}
function pickProv(btn){
  CUR.p = btn.getAttribute('data-prov'); CUR.c = '全部';
  document.querySelectorAll('#fp button').forEach(function(b){ b.classList.toggle('on', b === btn); });
  document.querySelectorAll('#fc button').forEach(function(b){
    b.classList.toggle('on', (b.getAttribute('data-prov') || '全部') === '全部');
  });
  applyFilter();
}
function pickCity(btn){
  CUR.c = btn.getAttribute('data-city');
  document.querySelectorAll('#fc button').forEach(function(b){ b.classList.toggle('on', b === btn); });
  applyFilter();
}

/* ===== 首页统计 / 筛选计数 / 页脚日期：一律按页面内容现算 =====
   原来「3 篇攻略 / 3 个目的地 / 14 张实拍」和筛选条里的 <i>1</i> 全是写死的，
   加一篇攻略要手改 5 处以上，漏一处就显示错。现在直接从 DOM 里数出来。
   HTML 里仍保留一份写死的值，作为无 JS 时的兜底。 */
var BUILD_DATE = '2026-09-18';      /* ← 以后重新生成站点时，只改这一处 */
(function(){
  function countBy(attr){
    var m = {};
    cards().forEach(function(c){
      var k = c.getAttribute(attr) || '';
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }
  var pc = countBy('data-prov'), cc = countBy('data-city');
  var total = cards().length;
  function fill(sel, attr, table){
    document.querySelectorAll(sel).forEach(function(b){
      var k = b.getAttribute(attr) || '全部';
      var i = b.querySelector('i');
      if(i) i.textContent = (k === '全部') ? total : (table[k] || 0);
    });
  }
  fill('#fp button', 'data-prov', pc);
  fill('#fc button', 'data-city', cc);

  var st = document.querySelectorAll('#v-home .stat b');
  if(st.length >= 3){
    st[0].textContent = total;                                             /* 篇攻略 */
    st[1].textContent = Object.keys(cc).length;                            /* 个目的地 */
    st[2].textContent = document.querySelectorAll('figure.ph img').length; /* 张实拍 */
  }
  var fl = document.querySelector('footer .fl');
  if(fl) fl.textContent = '生成于 ' + BUILD_DATE;
})();

/* ===== 悬浮章节目录（桌面右侧 / 手机底部）=====
   目录本体 toc-box 在正文最前面，滚过去就没了；长攻略滚到中部想跳章节
   只能一路滚回顶。这里按当前视图的 toc-box 链接生成一份浮动目录：
   · 内容从 toc-box 现读，新增攻略或调整章节不用改这里；
   · 点击走全局锚点委托（replaceState + scrollIntoView），不新增历史记录；
   · 滚动时高亮「已越过最后一个章节」，rAF 节流。 */
(function(){
  var st = document.createElement('nav');
  st.id = 'sidetoc';
  st.setAttribute('aria-label', '章节目录');
  document.body.appendChild(st);
  var links = [];   /* [{a, sec}] */

  function build(){
    var v = VIEW.cur;
    links = [];
    st.innerHTML = '';
    st.classList.remove('show');
    if(!v || v === 'home') return;
    var box = document.getElementById('v-' + v);
    var src = box ? box.querySelectorAll('.toc-box a[href^="#"]') : [];
    if(!src.length) return;
    var t = document.createElement('div');
    t.className = 'st-t';
    t.textContent = '本页目录';
    st.appendChild(t);
    src.forEach(function(a){
      var el = document.createElement('a');
      el.href = a.getAttribute('href');
      el.textContent = a.textContent;
      st.appendChild(el);
      var sec = document.getElementById(el.getAttribute('href').slice(1));
      if(sec) links.push({a: el, sec: sec});
    });
    st.classList.add('show');
    mark();
  }

  function mark(){
    var act = -1, i;
    for(i = 0; i < links.length; i++){
      if(links[i].sec.getBoundingClientRect().top <= 96) act = i;
    }
    for(i = 0; i < links.length; i++){
      links[i].a.classList.toggle('on', i === act);
    }
    /* 手机底部横滑条：高亮项滚到可视范围中间 */
    if(act >= 0 && st.scrollWidth > st.clientWidth + 8){
      var el = links[act].a;
      st.scrollTo({left: el.offsetLeft - st.clientWidth / 2 + el.offsetWidth / 2});
    }
  }

  var raf = window.requestAnimationFrame || function(f){ f(); };
  var ticking = false;
  window.addEventListener('scroll', function(){
    if(ticking) return;
    ticking = true;
    raf(function(){ ticking = false; if(links.length) mark(); });
  }, {passive: true});

  window.TOCbuild = build;
  window.addEventListener('hashchange', function(){ setTimeout(build, 0); });
  window.addEventListener('resize', function(){ if(links.length) mark(); }, {passive: true});
  build();
})();

/* ===== 出行清单：点击条目切换勾选状态 ===== */
(function(){
  document.addEventListener('click', function(e){
    var el = e.target;
    if(!el || !el.closest) return;
    var li = el.closest('ul.lst.ck li');
    if(li) li.classList.toggle('done');
  });
})();

/* ===== 景点速查：导航按钮 手机端唤起高德App，失败唤起百度地图App，再失败退回高德网页版 ===== */
(function(){
  var UA = navigator.userAgent;
  var isMobile = /android|iphone|ipad|ipod|harmony/i.test(UA);
  function tryScheme(url, onFail){
    var t0 = Date.now(), left = false;
    function onHide(){ left = true; }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    setTimeout(function(){
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if(!left && Date.now()-t0 < 3000) onFail();
    }, 1300);
    location.href = url; /* 尝试唤起 App */
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('.poi-links a');
    if(!a) return;
    var href = a.getAttribute('href') || '';
    var m = href.match(/[?&]to=([0-9.]+),([0-9.]+),([^&]+)/);
    if(!m) return;
    e.preventDefault();
    var lon = m[1], lat = m[2], name = m[3];
    try { name = decodeURIComponent(name); } catch(err) {}
    if(!isMobile){
      window.open(href); /* 桌面端没有 App，退回网页版 */
      return;
    }
    var isIOS = /iphone|ipad|ipod/i.test(UA);
    var amap = (isIOS ? 'iosamap' : 'androidamap')
      + '://viewMap?sourceApplication=tiantravel&poiname=' + encodeURIComponent(name)
      + '&lat=' + lat + '&lon=' + lon + '&dev=0';
    var baidu = 'baidumap://map/direction?destination=name:' + encodeURIComponent(name)
      + '|latlng:' + lat + ',' + lon + '&mode=driving&coord_type=gcj02&src=tiantravel';
    tryScheme(amap, function(){
      tryScheme(baidu, function(){
        window.open(href); /* 两个 App 都没装，退回高德网页版 */
      });
    });
  });
})();

/* ===== 景点速查：无坐标的 POI（关键词模式）同样优先唤起高德 App，失败再唤起百度地图 App ===== */
(function(){
  var UA = navigator.userAgent;
  var isMobile = /android|iphone|ipad|ipod/i.test(UA);
  var isIOS = /iphone|ipad|ipod/i.test(UA);
  function tryScheme(url, onFail){
    var t0 = Date.now(), left = false;
    function onHide(){ left = true; }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    setTimeout(function(){
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if(!left && Date.now()-t0 < 3000) onFail();
    }, 1300);
    location.href = url;
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('.poi-links a[data-keyword]');
    if(!a) return;
    e.preventDefault();
    var kw = a.getAttribute('data-keyword');
    var href = a.getAttribute('href');
    if(!isMobile){ window.open(href); return; }
    var amap = (isIOS ? 'iosamap' : 'androidamap')
      + '://poi?sourceApplication=tiantravel&keywords=' + encodeURIComponent(kw)
      + '&dev=0' + (isIOS ? '' : '&pkg=com.autonavi.minimap');
    var baidu = (isIOS ? 'baidumap' : 'bdapp')
      + '://map/place/search?query=' + encodeURIComponent(kw)
      + '&region=' + encodeURIComponent('湖州市安吉县') + '&src=tiantravel';
    tryScheme(amap, function(){
      tryScheme(baidu, function(){
        window.open(href);
      });
    });
  });
})();
