/* app-shell.js —— 攻略详情页「手机 App 壳」
   不动攻略原文档 DOM。从已加载视图按 11 章模板的 class 体系提取内容，
   组装成 6 Tab（首页/行程/美食/花销/准备/图集）+ 底部导航。
   壳始终构建（桌面也有），显示由 app-shell.css 的 @media(max-width:640px) 控制：
   手机看 App 壳、桌面看完整文档、打印不受影响。
   不符模板（缺「每日详细行程」章节，如象山旧结构）→ 不建壳，自动退回文档视图。 */
(function(){
'use strict';

var NAV = [
  ['home',  '首页', 'M3 11l9-8 9 8M5 9.5V20h14V9.5M10 20v-5h4v5'],
  ['route', '行程', 'M12 21s-6.5-5.7-6.5-10.6a6.5 6.5 0 1 1 13 0C18.5 15.3 12 21 12 21Zm0-8.4m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0'],
  ['food',  '美食', 'M4.5 11.5h15a7.5 7.5 0 0 1-15 0ZM2.5 20.5h19M9.5 3.5c-.6 1.5-.6 2.3 0 3.8M14 3.5c-.6 1.5-.6 2.3 0 3.8'],
  ['money', '花销', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 8l3 3.5L15 8M12 11.5V17M9.5 13h5M9.5 15.2h5'],
  ['prep',  '准备', 'M5 6h4M5 12h4M5 18h4M13 6h7M13 12h7M13 18h7'],
  ['photos','图集', 'M4 5.5h16v13H4zM4 15l4.5-4L12 14l3-2.5 5 4.5M15.5 9.3a1 1 0 1 0-2 0a1 1 0 0 0 2 0']
];

function chapterTab(t){
  if(/交通/.test(t)) return 'money';
  if(/预算|花销|记账/.test(t)) return 'money';
  if(/餐饮|吃什么|饭店/.test(t)) return 'food';
  if(/提示/.test(t)) return 'prep';
  if(/清单/.test(t)) return 'prep';
  if(/天气|穿衣/.test(t)) return 'prep';
  if(/速查|地址/.test(t)) return 'photos';
  if(/实拍/.test(t)) return 'photos';
  return null;
}
var SEC_TAB = {1:'money',2:'route',3:'route',4:'money',5:'prep',6:'route',7:'food',8:'route',9:'photos',10:'prep',11:'prep'};
function secTitle(sec){
  var h2 = sec.querySelector('h2');
  return h2 ? h2.textContent.replace(/\s+/g,'') : '';
}
function classify(view){
  var out = {};
  view.querySelectorAll('section.sec[id*="-sec-"]').forEach(function(sec){
    var t = secTitle(sec);
    var nM = sec.id.match(/-sec-(\d+)$/);
    var n = nM ? +nM[1] : 0;
    if(/每日|详细行程/.test(t)) out.daily = sec;
    else if(/概览|总览/.test(t)) out.overview = sec;
    else if(/距离|路线/.test(t)) out.dist = sec;
    else if(/速查|地址|导航/.test(t)) out.spots = sec;
    else {
      var tab = chapterTab(t);
      if(!tab && n) tab = SEC_TAB[n];
      if(tab){ (out[tab] = out[tab] || []).push(sec); }
    }
  });
  return out;
}
function el(cls){ var d = document.createElement('div'); d.className = cls; return d; }
function svgIcon(pathD, size){
  return '<svg width="' + (size||20) + '" height="' + (size||20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + pathD + '"/></svg>';
}
/* 克隆原章节进壳：去掉全部 id 与 .sec 类；旧目录内链改写为 data-goto；
   剥掉文档视图里注入的路线图（壳内单独重建） */
function cloneInto(sec, mount, extraCls){
  var c = sec.cloneNode(true);
  c.removeAttribute('id');
  c.querySelectorAll('[id]').forEach(function(e){ e.removeAttribute('id'); });
  c.classList.remove('sec');
  c.classList.add('apc');
  if(extraCls) c.classList.add(extraCls);
  /* 去掉章节标题的「一、二、…」「<span class=num>」序号（App 内不需要文档编号） */
  c.querySelectorAll('h2').forEach(function(h){
    var num = h.querySelector('.num'); if(num) num.remove();
    h.textContent = h.textContent.replace(/^[一二三四五六七八九十]+、\s*/, '').replace(/^\s+/, '');
  });
  c.querySelectorAll('.route-embed').forEach(function(x){ x.remove(); });
  c.querySelectorAll('a[href^="#"]').forEach(function(a){
    var h = a.getAttribute('href');
    if(!h || h.indexOf('#/') === 0) return;
    var m = h.match(/-sec-(\d+)$/);
    if(m && SEC_TAB[+m[1]]){
      a.removeAttribute('href');
      a.dataset.goto = SEC_TAB[+m[1]];
      a.classList.add('ap-jump');
    }
  });
  mount.appendChild(c);
  return c;
}

/* ===== 行程 Tab：Day rail + 每日分页 ===== */
/* 把「景点速查」的地址/营业时间/导航按钮内联到详细行程对应 .tl-item 里。
   匹配规则：.tl-a 标题含景点名（原名或去景区后缀核心词）；带 <strong> 的主景点条目优先。
   没匹配上的（如酒店）兜底放最后一页「住宿与备用地点」。 */
function mergeSpotsIntoDays(spotsSec, pages){
  var src = spotsSec.querySelector('.card') || spotsSec;
  var cards = [];
  src.querySelectorAll('.rt').forEach(function(rt){
    var h = rt.querySelector('.rt-h');
    if(!h) return;
    var name = h.textContent.replace(/\s+/g,'').replace(/（.*?）|\(.*?\)/g,'').trim();
    /* 匹配候选：原名 + 去常见场所后缀的核心词 + 「·」分隔的前段（≥3字才用，防误伤） */
    var keys = [name];
    var push = function(k){ if(k.length >= 3 && k !== name && keys.indexOf(k) < 0) keys.push(k); };
    push(name.replace(/(遗址博物馆|博物馆|纪念馆|历史文化街区|遗址公园|风景区|景区|公园|古镇|古城|纪念塔|步行街|商业街|营地|民宿|酒店|餐厅|漂流|馆)$/, ''));
    var seg = name.split('·')[0].trim();
    push(seg);
    cards.push({ name: name, keys: keys, node: rt });
  });
  if(!cards.length) return;
  var pageEls = [];
  pages.querySelectorAll('.ap-day-page').forEach(function(p){ pageEls.push(p); });
  if(!pageEls.length) return;
  var matched = {};
  /* 多轮匹配：先「标题含全名」→「标题含核心词」→「条目全文含核心词」。
     防止短核心词（如「溯野南溪」）抢先命中泛提及条目（如「装车出发」的备注行）。 */
  var rounds = function(pass){
    pageEls.forEach(function(p){
      cards.forEach(function(c){
        if(matched[c.name]) return;
        var item = pickTlItem(p, c.keys, pass);
        if(!item) return;
        matched[c.name] = 1;
        injectPoiInline(item, c.node);
      });
    });
  };
  rounds(0); rounds(1); rounds(2);
  /* 兜底：没被任何条目命中的卡片（酒店等），挂到最后一页 */
  var rest = cards.filter(function(c){ return !matched[c.name]; });
  if(rest.length){
    var last = pageEls[pageEls.length-1];
    var box = el('ap-day-spots');
    var cap = el('ap-spots-cap'); cap.textContent = '📍 住宿与备用地点';
    box.appendChild(cap);
    rest.forEach(function(c){
      var clone = c.node.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(function(e){ e.removeAttribute('id'); });
      /* 按钮不进壳；地址行 → 高德定位点链接 */
      linkifyAddr(c.node, clone);
      box.appendChild(clone);
    });
    last.appendChild(box);
  }
}
function pickTlItem(page, keys, pass){
  var best = null, bestStrong = false;
  var useKeys = pass === 0 ? keys.slice(0, 1) : keys;   /* 第 0 轮只用原名 */
  page.querySelectorAll('.tl-item').forEach(function(it){
    var a = it.querySelector('.tl-a');
    if(!a) return;
    var at = (a.textContent||'').replace(/\s+/g,'');
    var hit = false;
    for(var i=0;i<useKeys.length;i++){
      if(useKeys[i].length >= 3 && at.indexOf(useKeys[i]) >= 0){ hit = true; break; }
    }
    if(!hit) return;
    var strong = !!a.querySelector('strong');
    if(!best || (strong && !bestStrong)){ best = it; bestStrong = strong; }
  });
  if(best) return best;
  /* pass>=1 且标题没命中：退而求其次，条目全文命中的第一个 */
  if(pass >= 1){
    var items = page.querySelectorAll('.tl-item');
    for(var i=0;i<items.length;i++){
      var ft = (items[i].textContent||'').replace(/\s+/g,'');
      for(var j=0;j<keys.length;j++){
        if(keys[j].length >= 4 && ft.indexOf(keys[j]) >= 0) return items[i];
      }
    }
  }
  return null;
}
/* 从速查卡的「导航到这里」链接提取 to=lng,lat → 高德 marker 定位点链接。
   行程卡地址行 / 兜底卡地址都用它；按钮本身不再展示。 */
function amapPinHref(rt){
  var nav = rt.querySelector('.poi-links a[href*="to="]');
  if(!nav) return '';
  var m = (nav.getAttribute('href') || '').match(/[?&]to=([0-9.]+),([0-9.]+),([^&]+)/);
  if(!m) return '';
  var nm = m[3]; try{ nm = decodeURIComponent(nm); }catch(err){}
  return 'https://uri.amap.com/marker?position=' + m[1] + ',' + m[2] +
    '&name=' + encodeURIComponent(nm) + '&src=tiantian&callnative=0';
}
/* 把 .rt-d 地址行变成高德定位点链接（有坐标才变，否则保持纯文本） */
function linkifyAddr(rt, clone){
  var href = amapPinHref(rt);
  clone.querySelectorAll('.poi-links').forEach(function(x){ x.remove(); });
  var d = clone.querySelector('.rt-d');
  if(d && href){
    var a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'ap-poi-addr ap-map-link';
    a.textContent = '📍 ' + d.textContent.trim();
    a.title = '点击在高德地图中查看定位点';
    d.textContent = '';
    d.appendChild(a);
  }
}
function injectPoiInline(item, rt){
  var tc = item.querySelector('.tl-c');
  if(!tc) return;
  /* 同一条目可挂多张卡（如「深溪漂流」正文提到「天目山漂流·备选」），
     但同一张卡不重复注入（matched 已保证一卡一处，这里再防同名地址块叠加） */
  var newAddr = (rt.querySelector('.rt-d') || {}).textContent;
  newAddr = (newAddr || '').replace(/\s+/g,'').trim();
  if(newAddr){
    var dup = false;
    tc.querySelectorAll('.ap-poi-addr').forEach(function(x){
      if(x.textContent.replace(/\s+/g,'').indexOf(newAddr.slice(0,10)) >= 0) dup = true;
    });
    if(dup) return;
  }
  var box = el('ap-poi');
  var addr = rt.querySelector('.rt-d');
  var open = rt.querySelector('.rt-m');
  if(addr){
    var href = amapPinHref(rt);
    if(href){
      /* 地址整行做成高德定位点链接；「导航到这里/周边搜索」按钮不再展示 */
      var a1 = document.createElement('a');
      a1.href = href; a1.target = '_blank'; a1.rel = 'noopener';
      a1.className = 'ap-poi-addr ap-map-link';
      a1.textContent = '📍 ' + addr.textContent.trim();
      a1.title = '点击在高德地图中查看定位点';
      box.appendChild(a1);
    } else {
      var l1 = el('ap-poi-addr');
      l1.textContent = '📍 ' + addr.textContent.trim();
      box.appendChild(l1);
    }
  }
  if(open){
    var l2 = el('ap-poi-open');
    l2.textContent = '🕐 ' + open.textContent.trim();
    box.appendChild(l2);
  }
  /* 原「导航到这里 / 周边搜索」按钮：不再克隆进壳 */
  tc.appendChild(box);
}
/* 时间线卡片按内容类型着色：景点=品牌青(默认)、餐饮=橙、住宿=蓝、交通赶路=灰、小结提示=紫。
   关键词匹配顺序很重要：先吃住（「早餐，纪念馆周边逛逛」不能因为带景点名就判成景点），
   再交通；「步行/地铁到酒店办理入住」含地铁但入住优先 → 住宿。
   同时给标题前加类型图标、卡片背景带一层同色系淡色（见 app-shell.css）。 */
var TL_TYPE = {
  'k-tip':  { emo: '💡' },
  'k-food': { emo: '🍜' },
  'k-stay': { emo: '🏨' },
  'k-move': { emo: '🚗' },
  'k-play': { emo: '🏞' }
};
function paintTlPages(pages){
  pages.querySelectorAll('.ap-day-page .tl-item').forEach(function(it){
    var a = it.querySelector('.tl-a');
    var t = a ? (a.textContent || '').replace(/\s+/g, '') : '';
    if(!t) return;
    var k = '';
    if(/小结|提示|注意事项/.test(t)) k = 'k-tip';
    else if(/早餐|午餐|晚餐|小吃|夜宵|下午茶|咖啡/.test(t)) k = 'k-food';
    else if(/酒店|民宿|入住|退房/.test(t)) k = 'k-stay';
    else if(/抵达|到达|出发|返程|返回|地铁|打车|高铁|火车|机场|候车|乘车|坐车|赶/.test(t)) k = 'k-move';
    if(k) it.classList.add(k);
    /* 标题前加类型 emoji（防重复加：已以该 emoji 开头就跳过） */
    var emo = TL_TYPE[k || 'k-play'].emo;
    if(a && a.textContent.slice(0, emo.length) !== emo){
      a.textContent = emo + ' ' + a.textContent;
    }
  });
}

function buildRouteTab(sec, viewId, spotsSec){
  var wrap = el('ap-tab');
  var card = sec.querySelector('.card') || sec;
  var h2 = card.querySelector('h2');
  var days = [], cur = null;
  Array.prototype.forEach.call(card.children, function(ch){
    if(ch === h2) return;
    if(ch.tagName === 'H3' && ch.classList.contains('day')){
      cur = { title: ch.textContent.replace(/\s+/g,' ').trim(), nodes: [] };
      days.push(cur);
    } else if(cur){
      cur.nodes.push(ch);
    }
  });
  if(!days.length) return null;
  /* Day 胶囊只显示「Day N」（图标式），当天主题放在胶囊下方；
     rail 整体 position:sticky 吸顶常驻（见 app-shell.css），滚到哪都能切天 */
  var railWrap = el('ap-rail-wrap');
  var rail = el('ap-rail');
  var railTheme = el('ap-rail-theme');
  var pages = el('ap-rail-pages');
  var CAL_ICON = 'M4 5.5h16v14.5H4zM4 10h16M8.5 3.2v4M15.5 3.2v4';
  function themeOf(t){ return t.replace(/^Day\s*\d+\s*[：:·]\s*/, ''); }
  days.forEach(function(d, i){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ap-day' + (i === 0 ? ' on' : '');
    b.innerHTML = svgIcon(CAL_ICON, 15) + '<b></b>';
    b.querySelector('b').textContent = 'Day ' + (i+1);
    b.setAttribute('aria-label', d.title);
    rail.appendChild(b);
    var pg = el('ap-day-page' + (i === 0 ? ' on' : ''));
    d.nodes.forEach(function(node){
      var n = node.cloneNode(true);
      /* 克隆件一律去 id，防与原文档视图重复 */
      if(n.nodeType === 1){ n.removeAttribute('id'); }
      n.querySelectorAll && n.querySelectorAll('[id]').forEach(function(e){ e.removeAttribute('id'); });
      pg.appendChild(n);
    });
    pages.appendChild(pg);
    b.addEventListener('click', function(){
      if(b.classList.contains('on')) return;
      rail.querySelectorAll('.ap-day').forEach(function(x){ x.classList.remove('on'); });
      pages.querySelectorAll('.ap-day-page').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on');
      pg.classList.add('on');
      railTheme.textContent = themeOf(d.title);
      var sc = b.closest('.ap-main'); if(sc) sc.scrollTop = 0;   /* 切天回顶部 */
    });
  });
  railTheme.textContent = themeOf(days[0].title);
  railWrap.appendChild(rail);
  railWrap.appendChild(railTheme);
  wrap.appendChild(railWrap);
  wrap.appendChild(pages);
  /* 景点地址 + 导航按钮：内联注入到详细行程对应条目 */
  if(spotsSec) mergeSpotsIntoDays(spotsSec, pages);
  /* 卡片按内容类型着色（左竖条 + 时间胶囊） */
  paintTlPages(pages);
  /* 路线图：不再内嵌小图 iframe，只留一个图标入口跳全屏路线图 */
  var g = encodeURIComponent(viewId);
  var jump = el('ap-route-jump');
  jump.innerHTML = '<a class="ap-route-go" href="#/route?guide=' + g + '">' +
    svgIcon(NAV[1][2], 20) +
    '<span class="ap-rg-t"><b>行程路线图</b><i>地图 · 距离 · 每段交通方式</i></span><em>›</em></a>';
  wrap.appendChild(jump);
  return wrap;
}

/* ===== 首页 Tab ===== */
function buildHomeTab(view, parts){
  var wrap = el('ap-tab');
  var hero = view.querySelector('.guide-hero');
  if(hero){
    var hc = el('ap-hero');
    var h1 = document.createElement('h1');
    var h = hero.querySelector('h1');
    h1.textContent = h ? h.textContent : '';
    hc.appendChild(h1);
    var sp = document.createElement('p');
    sp.className = 'ap-spots';
    var spEl = hero.querySelector('.spots-line');
    sp.textContent = spEl ? spEl.textContent : '';
    hc.appendChild(sp);
    var chips = el('ap-chips');
    hero.querySelectorAll('.chip').forEach(function(c){
      var s = document.createElement('span');
      s.className = 'ap-chip';
      s.textContent = c.textContent;
      chips.appendChild(s);
    });
    hc.appendChild(chips);
    wrap.appendChild(hc);
  }
  var cd = buildCountdown(view);
  if(cd) wrap.appendChild(cd);
  var ov = buildOverviewCards(parts);
  if(ov) wrap.appendChild(ov);
  var quick = el('ap-quick');
  [['route','每日行程'],['money','交通与预算'],['food','餐饮推荐'],['photos','实拍图集']].forEach(function(q){
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.goto = q[0];
    b.innerHTML = '<b>' + q[1] + '</b>';
    quick.appendChild(b);
  });
  wrap.appendChild(quick);
  return wrap;
}
function buildCountdown(view){
  var yMatch = (view.textContent || '').match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if(!yMatch) return null;
  var d0 = new Date(+yMatch[1], +yMatch[2]-1, +yMatch[3], 0, 0, 0);
  var now = new Date();
  now.setHours(0,0,0,0);
  var dd = Math.round((d0 - now) / 86400000);
  var card = el('ap-count');
  if(dd > 0) card.innerHTML = '<b>还有 ' + dd + ' 天</b><span>' + yMatch[1] + '年' + yMatch[2] + '月' + yMatch[3] + '日 出发</span>';
  else if(dd === 0) card.innerHTML = '<b>今天出发</b><span>' + yMatch[2] + '月' + yMatch[3] + '日 · 一路顺利</span>';
  else if(dd > -7) card.innerHTML = '<b>刚结束的旅程</b><span>' + yMatch[1] + '年' + yMatch[2] + '月' + yMatch[3] + '日 出发</span>';
  else card.innerHTML = '<b>' + yMatch[1] + '-' + yMatch[2] + '-' + yMatch[3] + '</b><span>本次行程日期</span>';
  return card;
}

/* 概览表 → 「每天一个主题」卡片流（参考 dali 站首页）。
   解析第二章 table：Day 徽标 + 日期 + 主题 + 其余列拼成动线说明。 */
function buildOverviewCards(parts){
  if(!parts.overview) return null;
  var table = parts.overview.querySelector('table');
  if(!table) return null;
  var heads = [];
  table.querySelectorAll('thead th').forEach(function(th){ heads.push(th.textContent.replace(/\s+/g,'')); });
  var rows = table.querySelectorAll('tbody tr');
  if(!rows.length) return null;
  var idx = {};
  heads.forEach(function(h, i){
    if(/日期|时间/.test(h)) idx.date = i;
    else if(/主题|亮点|安排/.test(h)) idx.theme = i;
    else if(/景点|动线|路线|行程/.test(h)) idx.route = i;
    else if(/住宿/.test(h)) idx.stay = i;
  });
  var wrap = el('ap-days');
  var cap = el('ap-sec-cap'); cap.textContent = '每天一个主题';
  wrap.appendChild(cap);
  Array.prototype.forEach.call(rows, function(tr, ri){
    var tds = tr.querySelectorAll('td');
    if(!tds.length) return;
    var g = function(i){ return (i!=null && tds[i]) ? tds[i].textContent.trim() : ''; };
    var dayTag = g(0) || ('Day ' + (ri+1));
    var card = el('ap-dcard');
    var top = el('ap-dcard-top');
    var badge = el('ap-dcard-badge'); badge.textContent = dayTag;
    top.appendChild(badge);
    if(idx.date!=null && g(idx.date)){ var dt = el('ap-dcard-date'); dt.textContent = g(idx.date); top.appendChild(dt); }
    card.appendChild(top);
    var theme = el('ap-dcard-theme');
    theme.textContent = g(idx.theme) || dayTag;
    card.appendChild(theme);
    var detail = g(idx.route) || g(idx.stay);
    if(idx.theme!=null && g(idx.theme)){
      var extra = [];
      if(idx.route!=null && g(idx.route)) extra.push(g(idx.route));
      if(idx.stay!=null && g(idx.stay)) extra.push('住：' + g(idx.stay));
      detail = extra.join(' ');
    }
    if(detail){ var d = el('ap-dcard-detail'); d.textContent = detail; card.appendChild(d); }
    card.dataset.goto = 'route';
    card.setAttribute('role', 'button');
    wrap.appendChild(card);
  });
  return wrap;
}

/* 美食 tab：店名 → 高德地图搜索定位（攻略里店铺没有坐标，用关键词搜索）。
   同时按餐次给卡片着色（早餐橙 / 午餐青 / 晚餐紫，见 app-shell.css），
   并把「备选餐厅」的店名也做成高德搜索链接。 */
function linkFoodMeals(box){
  box.querySelectorAll('.meal').forEach(function(m){
    var name = m.querySelector('.ml-main');
    if(!name || name.querySelector('a')) return;
    var kw = name.textContent.replace(/\s+/g, ' ').trim();
    if(!kw) return;
    var a = document.createElement('a');
    a.href = 'https://uri.amap.com/search?keyword=' + encodeURIComponent(kw) + '&src=tiantian&callnative=1';
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'ap-map-link';
    a.textContent = kw;
    a.title = '点击在高德地图中搜索这家店';
    name.textContent = '';
    name.appendChild(a);
    /* 餐次着色 */
    var st = m.querySelector('.slot');
    var slotTxt = st ? st.textContent : '';
    if(/早/.test(slotTxt)) m.classList.add('f-break');
    else if(/午/.test(slotTxt)) m.classList.add('f-lunch');
    else if(/晚|夜/.test(slotTxt)) m.classList.add('f-dinner');
    /* 备选餐厅：按 <br> 分段，每段「备选N：店名（描述）」的店名 → 高德搜索链接 */
    var alt = m.querySelector('.ml-alt');
    if(alt && !alt.dataset.apLinked){
      alt.dataset.apLinked = '1';
      alt.innerHTML = alt.innerHTML.split(/<br\s*\/?>/i).map(function(seg){
        var mm = seg.match(/^([\s\S]*?<\/span>)?\s*([^（<]+)/);
        if(!mm) return seg;
        var head = mm[1] || '';
        var altName = mm[2].replace(/备选\d+[：:]\s*/, '').trim();
        if(!altName || altName.indexOf('）') >= 0) return seg;   /* 没有店名可链 */
        var href = 'https://uri.amap.com/search?keyword=' + encodeURIComponent(altName) + '&src=tiantian&callnative=1';
        var tail = seg.slice(mm[0].length);
        return head + '<a class="ap-map-link" target="_blank" rel="noopener" href="' + href +
          '" title="点击在高德地图中搜索这家店">' + altName + '</a>' + tail;
      }).join('<br>');
    }
  });
}

/* ===== 建壳 ===== */
function buildShell(viewId){
  var view = document.getElementById('v-' + viewId);
  if(!view) return;
  if(view.classList.contains('ap-done')){      /* 壳已建：只按 URL 恢复 Tab */
    if(view.__ap){
      var q = window.__routeParams;
      view.__ap.show((q && q.tab) || view.__apTab || 'home');
    }
    return;
  }
  var parts = classify(view);
  if(!parts.daily) return;                    /* 模板不符 → 文档视图兜底 */
  view.classList.add('ap-done', 'ap-shell');

  var app = el('ap-app');

  var head = el('ap-head');
  var back = document.createElement('button');
  back.type = 'button';
  back.className = 'ap-back';
  back.setAttribute('aria-label', '返回');
  back.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  var title = el('ap-title');
  var h1 = view.querySelector('h1');
  title.textContent = h1 ? h1.textContent : '攻略';
  var share = document.createElement('button');
  share.type = 'button';
  share.className = 'ap-share';
  share.textContent = '分享';
  head.appendChild(back); head.appendChild(title); head.appendChild(share);
  app.appendChild(head);

  var main = el('ap-main');
  var tabWrap = el('ap-tabs');
  main.appendChild(tabWrap);

  var built = {};
  built.home = buildHomeTab(view, parts);
  var routeTab = buildRouteTab(parts.daily, viewId, parts.spots);
  if(routeTab) built.route = routeTab;
  ['food','money','prep','photos'].forEach(function(tab){
    var box = el('ap-tab');
    (parts[tab] || []).forEach(function(sec){ cloneInto(sec, box); });
    if(tab === 'food') linkFoodMeals(box);   /* 店名 → 高德搜索定位 */
    if(box.children.length) built[tab] = box;
  });

  var order = NAV.filter(function(n){ return built[n[0]]; });
  var nav = el('ap-nav');
  order.forEach(function(n){
    tabWrap.appendChild(built[n[0]]);
    var b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = svgIcon(n[2]) + '<span>' + n[1] + '</span>';
    b.addEventListener('click', function(){ showTab(n[0]); });
    nav.appendChild(b);
  });
  function showTab(id){
    if(!built[id]) id = order[0][0];
    order.forEach(function(n, idx){
      var on = n[0] === id;
      built[n[0]].classList.toggle('on', on);
      nav.children[idx].classList.toggle('on', on);
    });
    main.scrollTop = 0;
    view.__apTab = id;
    try{ history.replaceState(history.state || {__tt:1}, '', '#/' + viewId + '?tab=' + id); }catch(err){}
  }
  tabWrap.addEventListener('click', function(e){
    var q = e.target.closest && e.target.closest('[data-goto]');
    if(q){ e.preventDefault(); showTab(q.getAttribute('data-goto')); }
  });

  back.addEventListener('click', function(){
    var V = window.VIEW;
    if(V && V.pushed && V.prev === 'home') history.back();
    else location.replace('#/');
  });
  share.addEventListener('click', function(){
    var url = location.href;
    function ok(){ share.textContent = '已复制'; setTimeout(function(){ share.textContent = '分享'; }, 1200); }
    function fb(){
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); ok(); }catch(err){}
      document.body.removeChild(ta);
    }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, fb);
    else fb();
  });

  app.appendChild(main);
  app.appendChild(nav);
  view.appendChild(app);
  view.__ap = { show: showTab };

  /* ?tab= 恢复 */
  var wantTab = window.__routeParams && window.__routeParams.tab;
  showTab(wantTab || view.__apTab || order[0][0]);
  mark(viewId);
}
/* 当前可见视图是否有壳 → html[data-ap]，CSS 据此隐藏站点顶栏/回顶/悬浮目录 */
function mark(target){
  var has = false;
  if(target && target !== 'home' && target !== 'route'){
    var view = document.getElementById('v-' + target);
    has = !!(view && view.classList.contains('ap-shell'));
  }
  document.documentElement.setAttribute('data-ap', has ? '1' : '0');
}

window.TG_appShell = { build: buildShell, mark: mark };
})();
