/* route.js —— 路线视图（只读）：完全按攻略「六、行程距离表」自动规划，基于高德 JS API 2.0。
 * 数据契约：每个 .rgroup[data-stops="A → B → …"] 是一天；组内 .rt 卡片按行驶顺序逐段
 * 给出 起→终 + 距离 + .pill 方式标签（car=打车/驾驶、walk=步行、bus=公交、pill 文本含「地铁」=地铁）。
 * 规划按距离表：节点序列、每段交通方式都从表里取（默认首选 pill）；每一段可在日卡片里
 * 单独切换交通方式（modeMan 标记后第六章不再覆盖）。 */
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  var STORE_KEY = 'tg_route_trip_v1';
  var OVERRIDE_KEY = 'tg_route_overrides_v1';   /* 手动修正坐标表 {地点名:{lat,lng}} */
  /* 链接参数指定初始天：#/route?guide=xx&day=2 → 直接看 Day 2 */
  function bootDayIdx() {
    var d = parseInt((window.__routeParams && window.__routeParams.day) || '', 10);
    return (d >= 1) ? d - 1 : 0;
  }
  var DAY_COLORS = ['#0ea5a4', '#7c3aed', '#d97706', '#dc2626', '#2563eb', '#16a34a', '#db2777', '#0891b2'];
 /* 每种交通方式固定一色：相同方式颜色相同，线色/光标点/编号统一取此色 */
  var MODE_COLOR = { car: '#4a7f92', bus: '#e8863a', metro: '#9061c4', bike: '#2f9e6b', walk: '#12a5b8', auto: '#8a94a6' };
 var TYPE_META = {
    attraction: { label: '景点', emoji: '🏞', stay: 120 },
    restaurant: { label: '餐厅', emoji: '🍜', stay: 60 },
    hotel:      { label: '酒店', emoji: '🏨', stay: 600 },
    other:      { label: '其他', emoji: '📍', stay: 60 }
  };
  var HOT_CITIES = ['北京', '上海', '广州', '成都', '杭州', '西安', '重庆', '南京', '武汉', '长沙', '厦门', '青岛'];
  /* 交通方式：k = 动画"秒/公里"系数（越小越快），pause = 到站停顿毫秒 */
 var MODE_META = {
    car:   { label: '小汽车', k: 0.55, min: 3, max: 10, pause: 110 },
    bus:   { label: '公交',   k: 0.8,  min: 3, max: 12, pause: 130 },
    metro: { label: '地铁',   k: 0.65, min: 3, max: 11, pause: 120 },
    bike:  { label: '骑行',   k: 1.1,  min: 4, max: 13, pause: 140 },
    walk:  { label: '走路',   k: 1.6,  min: 4, max: 15, pause: 160 }
 };
  var MODE_ICON = { auto: '🤖', car: '🚗', bus: '🚌', metro: '🚇', bike: '🚴', walk: '🚶' };
  var MODE_ORDER = ['car', 'bus', 'metro', 'bike', 'walk'];   /* 每段交通方式切换按钮的排列顺序 */

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dayColor(i) { return DAY_COLORS[i % DAY_COLORS.length]; }
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtKm(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
  function fmtDur(sec) {
    if (sec < 60) return '<1 分钟';
    var min = Math.round(sec / 60);
    if (min < 60) return min + ' 分钟';
    return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分';
  }
  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function downsample(pts, n) {
    if (pts.length <= n) return pts;
    var out = [], step = (pts.length - 1) / (n - 1);
    for (var i = 0; i < n; i++) out.push(pts[Math.round(i * step)]);
    return out;
  }

  /* ---------- 攻略坐标复用（免联网） ----------
     攻略页「景点速查」里的导航链接 href 形如
     https://uri.amap.com/navigation?to=115.88112,28.68151,滕王阁&...
     就是 GCJ-02 坐标，与高德 JS SDK 同一坐标系，导入时优先直接复用，
     匹配不到才联网解析。 */
  var STOP_SIM = 0.55;   /* 归一化名称重合度阈值：达到才算同一个点 */
  function normSpotName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s（）()\[\]【]·、，,。;；:：'"“”]+/g, '')
      .replace(/景区|景点|国家|考古|历史|文化|商务|国际|遗址|博物馆|纪念馆|公园|广场|街区|老街|古镇|码头|酒店|宾馆|民宿|客栈|站$/g, '');
  }
  function poiSim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
    /* 包含关系：至少 3 个字且占长名 4 成，才算同一个点
       （否则「八一」会把「八一广场」误配到「八一起义纪念馆」上） */
    if (short.length >= 3 && long.length <= short.length * 2.5 && long.indexOf(short) >= 0) return 0.9;
    if (short.length < 3) return 0;
    var m = {};
    for (var i = 0; i < a.length; i++) m[a[i]] = 1;
    var inter = 0;
    for (var j = 0; j < b.length; j++) { var c = b[j]; if (m[c]) { inter++; delete m[c]; } }
    return inter / Math.min(a.length, b.length);
  }
  /* 从一个攻略视图 DOM 提取「速查」区自带的导航坐标 */
  function extractPoiCoords(scope) {
    var out = [];
    if (!scope || !scope.querySelectorAll) return out;
    var as = scope.querySelectorAll('.poi-links a[href*="to="], a[href*="uri.amap.com/navigation?to="]');
    for (var i = 0; i < as.length; i++) {
      var href = as[i].getAttribute('href') || '';
      var m = href.match(/[?&]to=([0-9.]+),([0-9.]+),([^&]+)/);
      if (!m) continue;
      var raw = m[3];
      try { raw = decodeURIComponent(raw); } catch (e) { /* 保持原样 */ }
      var name = raw.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
      var lng = parseFloat(m[1]), lat = parseFloat(m[2]);
      if (!isFinite(lat) || !isFinite(lng) || lat < 3 || lat > 54 || lng < 73 || lng > 136) continue;
      out.push({ raw: raw, name: name, n: normSpotName(name), lat: lat, lng: lng });
    }
    return out;
  }
  function matchSpot(name, idx) {
    var q = normSpotName(name);
    var best = null, bs = 0;
    for (var i = 0; i < idx.length; i++) {
      var s = poiSim(q, idx[i].n);
      if (s > bs) { bs = s; best = idx[i]; }
    }
    return bs >= STOP_SIM ? best : null;
  }
  /* 从地点地址推断城市（Geocoder 失败时的兜底）：如「江西省南昌市西湖区…」→ 南昌 */
  function cityFromAddr(addr) {
    var m = String(addr || '').match(/[\u4e00-\u9fa5]{2,8}?(?:省|自治区)([\u4e00-\u9fa5]{1,8}?(?:市|自治州|地区|盟))/);
    if (m) return m[1].replace(/[市]$/, '') || m[1];
    var z = String(addr || '').match(/^(北京市|上海市|天津市|重庆市)/);
    return z ? z[1].replace(/市$/, '') : '';
  }

  /* ---------- 行程流水 + 距离表（权威数据源） ----------
     .rgroup[data-stops] 给出当天的节点序列；组内 .rt 卡片逐段给出距离与交通方式 pill。
     pill → 方式映射：.car→驾车、.walk→步行、.bus/.metro 且文本含「地铁」→地铁，否则→公交。 */
  function flowName(s) {
    var t = String(s || '').replace(/\s+/g, '').replace(/^(?:回|到达|抵达|前往|打车到|步行到|地铁到)+/, '');
    t = t.replace(/[（(][^）)]*[）)]$/, '');      /* 尾部注释：（入住）（退房）… */
    return t;
  }
  function flowType(name) {
    if (/酒店|民宿|宾馆|客栈/.test(name)) return 'hotel';
    if (/站$|机场|服务区|停车场/.test(name)) return 'other';
    if (/餐厅|菜馆|饭店|酒楼|大排档|食堂|小吃|面馆/.test(name)) return 'restaurant';
    return 'attraction';
  }
  var DIST_NUM = /([0-9]+(?:\.[0-9]+)?)\s*(公里|km|米|m)\b/i;
  function segDistM(txt) {
    var m = String(txt || '').match(DIST_NUM);
    if (!m) return null;
    var v = parseFloat(m[1]);
    return /公里|km/i.test(m[2]) ? v * 1000 : v;
  }
  function pillsOf(rtEl) {
    var out = [];
    var ps = rtEl.querySelectorAll('.pill');
    for (var i = 0; i < ps.length; i++) out.push(ps[i]);
    return out;
  }
  function pillMode(el) {
    if (el.classList.contains('walk')) return 'walk';
    if (el.classList.contains('bike')) return 'bike';
    if (el.classList.contains('metro') || /地铁/.test(el.textContent)) return 'metro';
    if (el.classList.contains('bus') || /公交/.test(el.textContent)) return 'bus';
    if (el.classList.contains('car')) return 'car';
    return '';
  }
  /* 该段所有可选方式（按 pill 出现顺序，第一个 = 第六章推荐的首选） */
  function segModesOf(rtEl) {
    var ps = pillsOf(rtEl), out = [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].classList.contains('no')) continue;   /* .no=无直达，不算可选方式 */
      var m = pillMode(ps[i]);
      if (m && out.indexOf(m) < 0) out.push(m);
    }
    return out;
  }
  /* 该段的规划方式：取第六章推荐的首选 pill。全局不再提供「地铁/打车优先」开关 ——
     每一段都可以在日卡片里单独改交通方式（见 renderCards 的 seg-modes 按钮）。 */
  function segModeOf(rtEl) {
    var ms = segModesOf(rtEl);
    return ms.length ? ms[0] : 'car';
  }
  function segLabelOf(rtEl) {
    var ps = pillsOf(rtEl);
    for (var i = 0; i < ps.length; i++) {
      var el = ps[i];
      if (el.classList.contains('no')) continue;
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return '';
  }
  /* 解析距离表 → [{ title, stops:[{name,type}], segs:[{mode,dist,planned,note}] }]
     segs[k] = 第 k+1 个点到第 k+2 个点这一段（segMode 等挂在后一个 stop 上，与 modeFrom 一致）。 */
  /* data-coords="名称:lng,lat|名称:lng,lat" —— 由「导出坐标 → apply_coords.py」写回第六章。
     这是路线图与第六章之间的双向同步通道：图上改了位置可固化进第六章，不再依赖浏览器缓存。 */
  function parseCoordsAttr(str) {
    var map = {};
    String(str || '').split('|').forEach(function (item) {
      var kv = item.split(':');
      if (kv.length !== 2) return;
      var nm = kv[0].trim(), ll = kv[1].split(',');
      if (!nm || ll.length !== 2) return;
      var lng = parseFloat(ll[0]), lat = parseFloat(ll[1]);
      if (isNaN(lng) || isNaN(lat)) return;
      map[nm] = { lng: lng, lat: lat };
      map[flowName(nm)] = { lng: lng, lat: lat };   /* 兼容带「回/打车到」等前缀的写法 */
    });
    return map;
  }
  function parseRgroup(rg) {
    var stopsAttr = rg.getAttribute('data-stops') || '';
    var names = stopsAttr.split(/→|->|=>|⇒|—>|；|;/)
      .map(flowName).filter(function (n) { return n.length >= 2; });
    if (names.length < 2) return null;
    var rts = rg.querySelectorAll('.rt');
    var coordMap = parseCoordsAttr(rg.getAttribute('data-coords'));
    var stops = names.map(function (n) {
      return { name: n, type: flowType(n), coord: coordMap[n] || null };
    });
    var segs = [];
    var usedRt = {};
    /* 尝试用 .rt 的 起→终 文本对位 data-stops 段序；对不上就按出现顺序顺排 */
    var rtList = [];
    for (var i = 0; i < rts.length; i++) rtList.push(rts[i]);
    var k = 0;
    for (var s = 1; s < names.length; s++) {
      var rt = rtList[k] || null;
      segs.push(rt ? {
        mode: segModeOf(rt),
        dist: segDistM(((rt.querySelector('.rt-d') || {}).textContent) || ''),
        planned: segLabelOf(rt),
        note: ''
      } : { mode: 'auto', dist: null, planned: '', note: '' });
      if (rt) usedRt[k] = 1;
      k++;
    }
    var title = ((rg.querySelector('.rg-h') || {}).textContent || '').trim();
    return { title: title, stops: stops, segs: segs };
  }
  function parseDistTable(scope) {
    var out = [];
    if (!scope || !scope.querySelectorAll) return out;
    var rgs = scope.querySelectorAll('.rgroup[data-stops]');
    for (var i = 0; i < rgs.length; i++) {
      var d = parseRgroup(rgs[i]);
      if (d) out.push(d);
    }
    return out;
  }
  /* 兼容旧格式：p.day-route[data-route]（只有顺序没有逐段方式） */
  function parseLegacyFlow(scope) {
    var out = [];
    if (!scope || !scope.querySelectorAll) return out;
    var ps = scope.querySelectorAll('p.day-route[data-route]');
    for (var i = 0; i < ps.length; i++) {
      var names = String(ps[i].getAttribute('data-route') || '')
        .split(/→|->|=>|⇒|—>|；|;/).map(flowName).filter(function (n) { return n.length >= 2; });
      if (names.length < 2) continue;
      out.push({
        title: '',
        stops: names.map(function (n) { return { name: n, type: flowType(n) }; }),
        segs: names.slice(1).map(function () { return { mode: 'auto', dist: null, planned: '', note: '' }; })
      });
    }
    return out;
  }

  /* ---------- 时间线回退（无距离表的旧攻略）：全部段 auto 按距离推断 ---------- */
  var POI_WORD = /景区|景点|博物馆|博物院|纪念馆|遗址|公园|广场|寺|塔|阁|山|岛|沙滩|海边|海岸|海滨|码头|街区|老街|古镇|步行街|湖|江|桥|乐园|摩天轮|动物园|植物园|图书馆|美术馆|科技馆|故居|书院|夜市|市场|菜场|面馆|大排档|瀑布|草原|湾|峰|谷|宫|庙|观|苑|园|区|城|村|镇|营地|舰|艇/;
  var HARD_NOISE = /休息|睡觉|补觉|午休|小憩|洗漱|冲澡|冲洗|淋浴|收拾|整理|装车|寄存|退房|取行李|行李|集合|候船|候车|排队|取号|逛吃|补给|购买|开吃|入住|换衣|换装|更衣|入园|离园|上岸|起床|清晨|早上|上午|中午|下午|傍晚|晚上|半夜|准备|低潮|高潮|退潮|涨潮|踏浪|玩沙|玩水|戏水|摸鱼|小龙虾|垂钓|上滩|下滩|附近|周边|一带|自选|加工|打包|拎/;
  var MEAL_WORD = /早餐|午餐|晚餐|宵夜|夜宵|中饭|午饭|早饭|晚饭|吃饭|用餐|美食/;
  var TRAVEL_WORD = /抵达|到达|返回|返程|回程|前往|出发|上车|下车|打车|驱车|自驾前往|自驾去|步行到|骑行|摆渡|转乘|路过|装车|启程|上路|上高速|下高速|离开|往回|抵沪|抵杭|抵甬|抵京|地铁|公交/;
  var ACTION_TAIL = /(看|观看|参观|游览|打卡|拍照|登顶|散步|闲逛|游玩|赏景|逛|上滩|下滩|自选|加工|打包|踏浪|玩沙|戏水)[^\s，,。]{0,10}$/;
  var MEAL_TAIL = /(早餐|午餐|晚餐|宵夜|夜宵|中饭|午饭|早饭|晚饭)$/;
  var EMOJI_TRAFFIC = ['🚙', '🚗', '🚌', '🚄', '🚅', '🚈', '🚕', '🛵', '✈️', '🚐', '🚎'];
  var EMOJI_MEAL = ['🍜', '🍽', '🍴', '🥢', '🦞', '🦐', '🍚', '🥟', '🍲', '🍱', '🥘', '🍤'];
  var EMOJI_HOTEL = ['🏨', '🛌', '🛏', '🛱', '🏩', '🏡'];
  var EMOJI_SKIP = ['🧳', '🎒', '🚻', '💤'];

  function cleanSpotName(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^[^\u4e00-\u9fa5A-Za-z0-9（(【\[]+/, '');
    s = s.replace(/^(到|去|在|进|逛)(?=[\u4e00-\u9fa5]{2})/, '');
    s = s.replace(/（?二选一）?|（可选）|（备选）|（待定）/g, '');
    s = s.replace(MEAL_TAIL, '');
    s = s.replace(/（[^）]*）$|\([^)]*\)$/, '');
    if (s.indexOf('→') >= 0) {
      var segs = s.split('→').map(function (x) { return x.trim(); }).filter(Boolean);
      s = segs.length ? segs[segs.length - 1] : s;
    }
    var parts = s.split(/\s*[\/、·+]\s*|\s*或\s*/), best = '';
    if (parts.length > 1) {
      parts.forEach(function (p) {
        p = p.trim();
        if (!POI_WORD.test(p) || HARD_NOISE.test(p)) return;
        if (p.length > best.length) best = p;
      });
      if (best.length <= 3 && parts[0].trim().length >= 2 && !HARD_NOISE.test(parts[0])) best = parts[0].trim();
      s = best || parts[0].trim();
    }
    var m = s.match(ACTION_TAIL);
    if (m) {
      var cut = s.slice(0, s.length - m[0].length);
      cut = cut.replace(/[（(][^）)]*$/, '').trim();
      if (cut.length >= 2 && POI_WORD.test(cut)) s = cut;
    }
    s = s.replace(/[，,。;；:：].*$/, '');
    if (/[（(]/.test(s) && !/[）)]/.test(s)) s = s.replace(/[（(][^（(]*$/, '');
    if (!/[（(]/.test(s)) s = s.replace(/[）)】\]]+$/, '');
    return s.trim();
  }
  function minutesOf(t) {
    var m = String(t || '').match(/(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    var a = (+m[1]) * 60 + (+m[2]), b = (+m[3]) * 60 + (+m[4]);
    if (b < a) b += 1440;
    return b - a;
  }
  function spotType(name) {
    if (/酒店|民宿|宾馆|客栈|套房/.test(name)) return 'hotel';
    if (/机场|服务区|停车场|高铁站|火车站|汽车站|客运站|动车站|地铁站|站$/.test(name)) return 'other';
    if (MEAL_WORD.test(name) || /餐厅|菜馆|饭店|酒楼|大排档|食堂|小吃|面馆/.test(name)) return 'restaurant';
    return 'attraction';
  }
  var DAY_HEAD = /^Day\s*\d|^第\s*[一二三四五六七八九十\d]+\s*天|^\s*D\s*\d+/i;

  function parseDetailDays(scope) {
    var out = [], cur = null;
    var nodes = scope.querySelectorAll('h1, h2, h3, h4, p, .tl-item');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (/^H[1-4]$/.test(el.tagName) || el.tagName === 'P') {
        var htx = el.textContent.replace(/\s+/g, ' ').trim();
        if (DAY_HEAD.test(htx) && htx.length < 60) { cur = []; out.push(cur); }
        continue;
      }
      if (!cur) continue;
      var a = el.querySelector('.tl-a');
      if (!a) continue;
      var strong = a.querySelector('strong');
      var raw = (strong || a).textContent.replace(/\s+/g, ' ').trim();
      if (!raw || raw.length > 26) continue;
      var c0 = Array.from(raw)[0] || '';
      if (EMOJI_TRAFFIC.indexOf(c0) >= 0 || EMOJI_SKIP.indexOf(c0) >= 0) continue;
      var isMeal = EMOJI_MEAL.indexOf(c0) >= 0;
      var isHotel = EMOJI_HOTEL.indexOf(c0) >= 0;
      var stM = (a.textContent || '').match(/(?:抵达|到达|打车到|前往|返回|回到)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,10}?(?:高铁站|火车站|机场|客运站|站))/);
      if (stM) {
        var stName = stM[1], stDup = false;
        for (var k2 = 0; k2 < cur.length; k2++) if (cur[k2].name === stName) { stDup = true; break; }
        if (!stDup) {
          var t2 = ((el.querySelector('.tl-t') || {}).textContent || '').trim();
          cur.push({ name: stName, type: 'other', stay: 0, time: t2 });
        }
        continue;
      }
      if (TRAVEL_WORD.test(raw.replace(/^[^\u4e00-\u9fa5]+/, ''))) continue;
      var name = cleanSpotName(raw);
      if (!name || name.length < 2) continue;
      if (HARD_NOISE.test(name)) continue;
      if (TRAVEL_WORD.test(name)) continue;
      if (!isMeal && MEAL_WORD.test(name)) continue;
      if (MEAL_TAIL.test(raw) && !/餐厅|菜馆|饭店|酒楼|大排档|食堂|小吃|面馆/.test(raw)) {
        var desc = ((el.querySelector('.tl-n') || {}).textContent || '').replace(/\s+/g, ' ').trim();
        var cand = '';
        var mShop = desc.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,12}（[^）]{2,14}店）)/);
        if (mShop) cand = mShop[1];
        else {
          var mHead = desc.match(/^([\u4e00-\u9fa5A-Za-z0-9]{2,12})(?=[（，,：:、])/);
          if (mHead && !/逛吃|推荐|详见|附近|周边|班次|人均|提前|建议/.test(mHead[1])) cand = mHead[1];
        }
        if (cand) {
          var mn = cleanSpotName(cand);
          if (mn && mn.length >= 2 && !HARD_NOISE.test(mn) && !TRAVEL_WORD.test(mn)) {
            var t3 = ((el.querySelector('.tl-t') || {}).textContent || '').trim();
            var mealDup = false;
            for (var k3 = 0; k3 < cur.length; k3++) if (cur[k3].name === mn) { mealDup = true; break; }
            if (!mealDup) cur.push({ name: mn, type: 'restaurant', stay: 60, time: t3 });
          }
        }
        continue;
      }
      var dup = false;
      for (var k = 0; k < cur.length; k++) if (cur[k].name === name) { dup = true; break; }
      if (dup) continue;
      var t = ((el.querySelector('.tl-t') || {}).textContent || '').trim();
      var mins = minutesOf(t);
      cur.push({
        name: name, raw: raw,
        type: isMeal ? 'restaurant' : (isHotel ? 'hotel' : spotType(name)),
        stay: mins ? Math.max(30, Math.min(mins, 480)) : 0,
        time: t
      });
    }
    var days = out.filter(function (d) { return d.length > 0; });
    return days.map(function (arr) {
      return { title: '', stops: arr, segs: arr.slice(1).map(function () { return { mode: 'auto', dist: null, planned: '', note: '' }; }) };
    });
  }

  /* ---------- 状态 ---------- */
  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var t = JSON.parse(raw);
      if (t && Array.isArray(t.days) && t.days.length) return t;
    } catch (e) { /* 损坏数据丢弃 */ }
    return null;
  }
  function save() {
    trip.updatedAt = Date.now();
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(trip)); } catch (e) { /* 忽略 */ }
  }
  /* 手动定位修正表 { 地点名: {lat,lng} }：按名字记，攻略重新导入/缓存重建也能套回去 */
  function loadOverrides() {
    try {
      var o = JSON.parse(window.localStorage.getItem(OVERRIDE_KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }
  var overrides = loadOverrides();
  function seedOverridesFromTrip() {
    var dirty = false;
    (trip.days || []).forEach(function (d) {
      (d.stops || []).forEach(function (s) {
        if (s.manual && typeof s.lat === 'number' && !overrides[s.name]) {
          overrides[s.name] = { lat: s.lat, lng: s.lng }; dirty = true;
        }
      });
    });
    if (dirty) { try { window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides)); } catch (e) {} }
  }
  function setOverride(name, lat, lng) {
    if (!name) return false;
    overrides[name] = { lat: lat, lng: lng };
    try {
      window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides));
      /* 回读校验：真的写进去了才算成功 */
      var back = JSON.parse(window.localStorage.getItem(OVERRIDE_KEY) || '{}');
      if (back && back[name] && Math.abs(back[name].lat - lat) < 1e-9) return true;
      return false;
    } catch (e) { return false; }
  }
  function overrideCount() {
    var n = 0;
    for (var k in overrides) if (overrides.hasOwnProperty(k)) n++;
    return n;
  }

  var trip = load() || { title: '', city: null, days: [], guideSlug: '', updatedAt: Date.now() };
  seedOverridesFromTrip();
  /* 攻略原文缓存：改出行方式时据此重读第六章（离线重算，不重复联网定位） */
  var lastHtml = '', lastSlug = '';
  /* 兼容旧缓存里的编辑结构（days[].stops 无 segs）：直接丢弃，重新从攻略导入 */
  if (trip.days.some(function (d) { return !Array.isArray(d.stops); })) trip.days = [];
  var activeDay = 0;
  var routeCache = {};     // dayIdx -> { segments, totalDistance, totalDuration, estCount }

  var infoWin = null;
  var importing = false;   // 当前 trip 来自攻略导入且尚未落库（不缓存半截状态）

  /* ---------- DOM ---------- */
  var elDayTabs = $('day-tabs'), elDayCards = $('day-cards'), elRouteStatus = $('route-status');
  var elTripLabel = $('trip-title-label'), elBackGuide = $('back-guide'), elRouteHint = $('route-hint');
  var elBrand = document.querySelector('.route-top .brand');

  /* 轻提示：保存/导出等操作的即时反馈 */
  function toast(msg, ms) {
    var el = document.createElement('div');
    el.className = 'route-toast';
    el.textContent = msg;
    (document.body || document.documentElement).appendChild(el);
    setTimeout(function () { el.classList.add('on'); }, 20);
    setTimeout(function () {
      el.classList.remove('on');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, ms || 2600);
  }

  /* 拿到某篇攻略的原文 HTML：内存缓存 → 页面里已加载的 DOM → fetch 文件。
     三条来源保证「切出行方式」「校正缓存」永远能重读第六章，不会因缓存态失效。 */
  function guideHtmlOf(slug) {
    if (lastHtml && (!slug || lastSlug === slug)) return Promise.resolve(lastHtml);
    if (!slug) return Promise.reject(new Error('no-slug'));
    var viewEl = document.getElementById('v-' + slug);
    if (viewEl && viewEl.querySelector('.rgroup[data-stops]')) {
      lastHtml = viewEl.outerHTML || ''; lastSlug = slug;
      return Promise.resolve(lastHtml);
    }
    return fetch('views/' + slug + '.html')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (h) { lastHtml = h; lastSlug = slug; return h; });
  }

  /* 用攻略第六章的每段方式校正当前行程。返回改动的段数。
     🔴 planDay 实际读的是 stops[k+1].modeFrom，所以 segs[].mode 与 modeFrom 必须一起改。 */
  function applyGuideModes(html, slug) {
    if (!html || !trip.days.length) return 0;
    var p = parseGuideHtml(html, slug);
    if (!p || !p.days.length) return 0;
    var changed = 0;
    p.days.forEach(function (nd, i) {
      var td = trip.days[i];
      if (!td || !td.segs) return;
      for (var k = 0; k < td.segs.length; k++) {
        var ns = (nd.segs && nd.segs[k]) || null;
        if (!ns || !ns.mode) continue;
        var st = td.stops[k + 1];
        /* 用户在这段上手动改过交通方式 → 第六章的推荐不再覆盖 */
        if (st && st.modeMan) continue;
        if (td.segs[k].mode !== ns.mode) { td.segs[k].mode = ns.mode; changed++; }
        if (ns.planned) td.segs[k].planned = ns.planned;
        if (st) {
          st.modeFrom = ns.mode;
          if (ns.planned) st.modePlanned = ns.planned;
        }
      }
    });
    return changed;
  }

  /* ---------- 地图 ---------- */
  function numBadgeDataUrl(color, n) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38">' +
      '<path d="M15 1C7.5 1 1.5 6.9 1.5 14.2 1.5 23 9 30.5 15 36.5c6-6 13.5-13.5 13.5-22.3C28.5 6.9 22.5 1 15 1z" fill="' + color + '" stroke="#ffffff" stroke-width="2"/>' +
      '<text x="15" y="19" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="bold" fill="#ffffff" text-anchor="middle">' + n + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function vehicleIconDataUrl(mode) {
    var col = MODE_COLOR[mode] || MODE_COLOR.auto;
    var W = '#ffffff';
    var inner;
    if (mode === 'car') {
      /* 小米澎程 N90 探索版俯视（按实车照片）：蓝青漆面 / 黑色车顶 / 贯穿式前灯带 /
         白色帆布升顶露营舱（带帆布缝线与支架） / 行李架纵轨 / 尾部星环灯带 */
      var body = '#4a7f92', shade = '#33586b', glass = '#1d2b33', canvas = '#f4f1e8', seam = '#d8d2c2';
      inner =
        '<rect x="12.2" y="28.2" width="4.4" height="7" rx="2.2" fill="#1c2733"/>' +
        '<rect x="25.4" y="28.2" width="4.4" height="7" rx="2.2" fill="#1c2733"/>' +
        '<rect x="12.2" y="92.8" width="4.4" height="7" rx="2.2" fill="#1c2733"/>' +
        '<rect x="25.4" y="92.8" width="4.4" height="7" rx="2.2" fill="#1c2733"/>' +
        '<rect x="11" y="6" width="26" height="100" rx="13" fill="' + body + '" stroke="' + shade + '" stroke-width="3"/>' +
        '<rect x="13.5" y="10" width="21" height="2.6" rx="1.3" fill="#eaf4f6"/>' +
        '<rect x="14.5" y="14.5" width="19" height="6" rx="2.7" fill="' + glass + '"/>' +
        '<rect x="12.6" y="18" width="3.4" height="8" rx="1.6" fill="' + shade + '"/>' +
        '<rect x="32" y="18" width="3.4" height="8" rx="1.6" fill="' + shade + '"/>' +
        '<rect x="14.5" y="22.5" width="19" height="9" rx="3" fill="' + shade + '" opacity="0.85"/>' +
        '<rect x="10" y="33.5" width="28" height="3.2" rx="1.6" fill="' + shade + '" opacity="0.8"/>' +
        '<rect x="10.5" y="38.5" width="27" height="36" rx="7" fill="' + canvas + '" stroke="' + shade + '" stroke-width="2.2"/>' +
        '<rect x="17" y="42.5" width="14" height="28" rx="4" fill="none" stroke="' + seam + '" stroke-width="1.3"/>' +
        '<path d="M13.5 51.5 H34.5 M13.5 61.5 H34.5" stroke="' + seam + '" stroke-width="1.1" fill="none"/>' +
        '<rect x="20.5" y="46.5" width="7" height="6" rx="1.6" fill="' + glass + '" opacity="0.85"/>' +
        '<rect x="12.5" y="76.5" width="3" height="13" rx="1.5" fill="' + canvas + '" stroke="' + seam + '" stroke-width="0.8"/>' +
        '<rect x="32.5" y="76.5" width="3" height="13" rx="1.5" fill="' + canvas + '" stroke="' + seam + '" stroke-width="0.8"/>' +
        '<rect x="13.5" y="94" width="21" height="3.4" rx="1.7" fill="rgba(255,255,255,0.92)"/>' +
        '<text x="24" y="102.6" font-family="Arial,Helvetica,sans-serif" font-size="4" font-weight="bold" fill="' + canvas + '" text-anchor="middle" opacity="0.95">N90</text>';
        } else {
      var glyph = {
        bus: '<rect x="7.5" y="10" width="19" height="15" rx="3" fill="' + W + '" stroke="' + col + '" stroke-width="2.4"/>' +
             '<rect x="10" y="12.5" width="5.2" height="4.2" rx="1" fill="' + col + '"/>' +
             '<rect x="18.8" y="12.5" width="5.2" height="4.2" rx="1" fill="' + col + '"/>' +
             '<circle cx="11.5" cy="27.5" r="2.3" fill="' + W + '" stroke="' + col + '" stroke-width="1.8"/>' +
             '<circle cx="22.5" cy="27.5" r="2.3" fill="' + W + '" stroke="' + col + '" stroke-width="1.8"/>',
        metro: '<rect x="8.5" y="8" width="17" height="17" rx="5" fill="' + W + '" stroke="' + col + '" stroke-width="2.4"/>' +
               '<rect x="11.5" y="11.5" width="11" height="6" rx="1.5" fill="' + col + '"/>' +
               '<circle cx="13" cy="20.5" r="1.6" fill="' + col + '"/>' +
               '<circle cx="21" cy="20.5" r="1.6" fill="' + col + '"/>' +
               '<path d="M12.5 26.5 L9.5 30 M21.5 26.5 L24.5 30" stroke="' + col + '" stroke-width="2.2" stroke-linecap="round"/>',
        bike: '<circle cx="10" cy="21" r="4.6" fill="none" stroke="' + W + '" stroke-width="2.4"/>' +
              '<circle cx="24" cy="21" r="4.6" fill="none" stroke="' + W + '" stroke-width="2.4"/>' +
              '<path d="M10 21 L14.8 12 L19.6 21 M14.8 12 H19 M13 16.5 H17" fill="none" stroke="' + W + '" stroke-width="2.2" stroke-linecap="round"/>',
        walk: '<circle cx="20" cy="10.5" r="3.2" fill="' + W + '"/>' +
              '<path d="M20 14.8 L18.8 21.5 M18.8 21.5 L15 28.5 M18.8 21.5 L23 28 M14.5 17.5 L24 16.5" fill="none" stroke="' + W + '" stroke-width="2.5" stroke-linecap="round"/>'
      }[mode] || '';
      inner = '<circle cx="17" cy="17" r="15.4" fill="' + col + '" stroke="#ffffff" stroke-width="2.4"/>' + glyph;
    }
    var vb = mode === 'car' ? 'viewBox="0 0 48 112"' : 'viewBox="0 0 34 34"';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" ' + vb + ' width="34" height="' +
      (mode === 'car' ? '79' : '34') + '">' + inner + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function vehImg(mode) {
    if (mode === 'car') {
      /* N90 探索版实车照片光标（images/n90-cursor.png，已抠底）。
         图片缺失/加载失败时回退到 SVG 车图标，绝不出现空白光标。 */
      return '<img src="images/n90-cursor.png" alt="车" draggable="false"' +
        ' style="display:block;width:64px;height:auto"' +
        ' onerror="this.onerror=null;this.src=\'' + vehicleIconDataUrl('car') + '\';this.style.width=\'34px\';">';
    }
    return '<img src="' + vehicleIconDataUrl(mode) + '" style="display:block;width:34px;height:34px" draggable="false">';
  }
  function pinImg(color, n) {
    return '<img src="' + numBadgeDataUrl(color, n) + '" style="display:block;width:30px;height:38px" draggable="false">';
  }

  var map = new AMap.Map('map-canvas', { zoom: 5, center: [121.47, 31.23], viewMode: '2D' });
  window.__routeMap = map;
  var stopMarkers = [];
  var lineOverlays = [];
  var flowMarker = null;
  var flowCurMode = '';

  function clearOverlays(arr) {
    arr.forEach(function (o) { map.remove(o); });
    arr.length = 0;
  }

  /* ---------- 手动定位 ---------- */
  var pickingStopId = null;
  function showMapTip(msg) {
    var tip = $('map-tip');
    if (!tip) return;
    tip.textContent = msg;
    tip.classList.add('show');
  }
  function hideMapTip() {
    var tip = $('map-tip');
    if (tip) tip.classList.remove('show');
  }
  function startPicking(stopId) {
    var f = findStopById(stopId);
    if (!f) return;
    pickingStopId = stopId;
    map.setDefaultCursor('crosshair');
    showMapTip('点击地图为「' + f.stop.name + '」选择位置，或拖动已有标记微调');
  }
  function stopPicking() {
    pickingStopId = null;
    map.setDefaultCursor('');
    hideMapTip();
  }
  map.on('click', function (e) {
    if (!pickingStopId) return;
    var f = findStopById(pickingStopId);
    if (!f) { stopPicking(); return; }
    var ll = e.lnglat;
    f.stop.lat = typeof ll.getLat === 'function' ? ll.getLat() : ll.lat;
    f.stop.lng = typeof ll.getLng === 'function' ? ll.getLng() : ll.lng;
    f.stop.manual = false;
    f.stop.coordSrc = 'manual';
    var okSave = setOverride(f.stop.name, f.stop.lat, f.stop.lng);
    toast(okSave
      ? '✅ 已保存「' + f.stop.name + '」的位置，下次打开自动使用'
      : '⚠️ 保存失败：浏览器不允许本地存储（隐私模式？）');
    delete routeCache[f.day];
    stopPicking();
    save();
    renderAll();
    planDay(f.day).then(function () { renderAll(); });
  });

  function openStopInfo(s, dayIdx) {
    if (s.lat === null || s.lat === undefined) return;
    var meta = TYPE_META[s.type] || TYPE_META.other;
    if (!infoWin) infoWin = new AMap.InfoWindow({ anchor: 'bottom-center', offset: new AMap.Pixel(0, -34) });
    infoWin.setContent(
      '<div style="font-size:13px;line-height:1.7;max-width:260px">' +
      '<div style="font-weight:600">Day ' + (dayIdx + 1) + ' · ' + escapeHtml(s.name) + '</div>' +
      '<div>' + meta.emoji + ' ' + meta.label + ' · 建议停留 ' + fmtDur(s.stay * 60) + '</div>' +
      '<div style="color:#6b7280">' + escapeHtml(s.address || '') + '</div></div>'
    );
    infoWin.open(map, [s.lng, s.lat]);
  }

  /* ---------- 服务 ---------- */
  var geocoderSvc = null, drivingSvc = null;
  function getGeocoder() { return geocoderSvc || (geocoderSvc = new AMap.Geocoder({ city: '全国' })); }
  function getDriving() {
    return drivingSvc || (drivingSvc = new AMap.Driving({
      policy: (window.AMap.DrivingPolicy || {}).LEAST_TIME || 0
    }));
  }

  /* ---------- 查询 ---------- */
  function findStopById(id) {
    for (var d = 0; d < trip.days.length; d++) {
      var arr = trip.days[d].stops;
      for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return { day: d, order: i, stop: arr[i] };
    }
    return null;
  }

  /* ---------- 渲染 ---------- */
  function renderTabs() {
    /* 顶部 Day 切换胶囊已取消（改到每张日卡片头部点击切换），容器留空隐藏 */
    if (elDayTabs) { elDayTabs.innerHTML = ''; elDayTabs.style.display = 'none'; }
  }

  function daySummary(i) {
    var r = routeCache[i];
    if (!r) return '';
    var txt = fmtKm(r.totalDistance) + ' · 用时 ' + fmtDur(r.totalDuration);
    if (r.estCount) txt += '（' + r.estCount + ' 段估算）';
    return txt;
  }

  function renderCards() {
    var html = '', m = globalSeqMap();
    trip.days.forEach(function (d, i) {
      var c = dayColor(i);
      var isOn = i === activeDay;
      /* day-head 即切换按钮：激活天实色、非激活天浅底描边，点击切换到该天 */
      var headStyle = isOn
        ? 'background:' + c + ';color:#fff'
        : 'background:#fff;color:' + c + ';border-bottom:1px solid ' + c;
      html += '<div class="day-card' + (isOn ? ' on' : '') + '"' +
        (isOn ? ' style="box-shadow:0 0 0 2px ' + c + ' inset"' : '') + '>' +
        '<div class="day-head switch" data-day="' + i + '" style="' + headStyle + '" title="点击查看这一天">' +
        '<span class="dh-tag"' + (isOn ? '' : ' style="color:' + c + '"') + '>' +
        (isOn ? '●' : '○') + ' ' + escapeHtml(d.title || 'Day ' + (i + 1)) + '</span>' +
        '<span class="day-sum">' + (daySummary(i) || '…') + '</span>' +
        '<span class="dh-arrow"' + (isOn ? '' : ' style="color:' + c + '"') + '>查看 →</span>' +
        '</div>';
      d.stops.forEach(function (s, j) {
        var meta = TYPE_META[s.type] || TYPE_META.other;
        var sg = m[s.id] || { seq: j + 1, color: c };
        var seg = (d.segs && d.segs[j - 1]) || null;
        var planned = seg && seg.planned ? seg.planned : '';
        var segInfo = '', segModesHtml = '';
        if (j > 0) {
          var mm = (routeCache[i] && routeCache[i].segments[j - 1]) || null;
          if (mm) {
            segInfo = (MODE_ICON[mm.mode] || '') + ' 实测 ' + fmtKm(mm.distance) + ' · ' + fmtDur(mm.duration);
            /* 地铁段：显示「经XX站」，两段都是步行导航（起点→地铁站→目的地） */
            if (mm.via) segInfo += ' · 经' + escapeHtml(mm.via);
          }
          else if (planned) segInfo = planned;
          /* 每段可改交通方式：点小按钮按所选方式重新规划这一段（点完立即重算并保存） */
          var curMode = (mm && mm.mode) || (seg && seg.mode) || s.modeFrom || 'car';
          var chips = '';
          for (var mi = 0; mi < MODE_ORDER.length; mi++) {
            var mv = MODE_ORDER[mi];
            chips += '<button type="button" class="seg-m' + (mv === curMode ? ' on' : '') +
              '" data-setmode="1" data-day="' + i + '" data-j="' + j + '" data-mode="' + mv + '"' +
              ' title="按' + MODE_META[mv].label + '重新规划这一段">' + MODE_ICON[mv] + MODE_META[mv].label + '</button>';
          }
          segModesHtml = '<span class="seg-modes">' + chips + '</span>';
        }
        var unlocated = s.lat === null || s.lat === undefined;
        html += '<div class="stop-row' + (unlocated ? ' unlocated' : '') + '">' +
          '<div class="stop-item">' +
          '<span class="stop-no" style="background:' + sg.color + '">' + sg.seq + '</span>' +
          '<span class="stop-main" data-goto="' + s.id + '" title="点击定位到地图" style="cursor:pointer">' +
          '<span class="stop-name">' + meta.emoji + ' ' + escapeHtml(s.name) +
          (unlocated ? ' <span class="loc-warn">未定位</span>' : (s.coordSrc === 'manual' || s.name && overrides[s.name] ? ' <span class="loc-manual">手动位置</span>' : '')) + '</span>' +
          '<span class="stop-meta">' + escapeHtml(s.address || '') +
          (segInfo ? '<br>' + escapeHtml(segInfo) : '') + segModesHtml + '</span></span>' +
          '<span class="stop-ops"><button class="btn-locate" data-locate="' + s.id + '" title="' +
          (unlocated ? '在地图上点击设置位置' : '位置不对？在地图上点击重新设置，或直接拖动地图上的标记') + '">' +
          (unlocated ? '手动定位' : '调整位置') + '</button></span>' +
          '</div>' +
          '</div>';
      });
      html += '</div>';
    });
    elDayCards.innerHTML = html;
  }

  function globalSeqMap() {
    var m = {};
    trip.days.forEach(function (d) {
      var n = 0;
      d.stops.forEach(function (s) {
        n++;
        /* 编号点颜色 = 抵达该点所用交通方式的颜色（与线段同色）；首点/未知取灰 */
        var col = MODE_COLOR[s.modeFrom] || MODE_COLOR.auto;
        m[s.id] = { seq: n, color: col };
      });
    });
    return m;
  }

  function renderMarkers() {
    clearOverlays(stopMarkers);
    var m = globalSeqMap();
    trip.days.forEach(function (d, i) {
      if (i !== activeDay) return;
      d.stops.forEach(function (s) {
        if (s.lat === null || s.lat === undefined || s.lng === null || s.lng === undefined) return;
        var g = m[s.id];
        var mk = new AMap.Marker({
          map: map,
          position: [s.lng, s.lat],
          anchor: 'bottom-center',
          content: pinImg(g.color, g.seq),
          zIndex: 120,
          draggable: true,
          cursor: 'move'
        });
        mk.on('click', function () { openStopInfo(s, i); });
        mk.on('dragend', function () {
          var ll = mk.getPosition();
          s.lat = typeof ll.getLat === 'function' ? ll.getLat() : ll.lat;
          s.lng = typeof ll.getLng === 'function' ? ll.getLng() : ll.lng;
          s.coordSrc = 'manual';
          var okDrag = setOverride(s.name, s.lat, s.lng);
          toast(okDrag
            ? '✅ 已保存「' + s.name + '」的新位置，下次打开自动使用'
            : '⚠️ 保存失败：浏览器不允许本地存储（隐私模式？）');
          delete routeCache[i];
          save();
          renderMarkers(); renderLines();
          planDay(i).then(function () { renderAll(); });
        });
        stopMarkers.push(mk);
      });
    });
  }

  function renderLines() {
    clearOverlays(lineOverlays);
    trip.days.forEach(function (d, i) {
      if (i !== activeDay) return;
      var r = routeCache[i];
      if (!r || !r.segments.length) return;
      r.segments.forEach(function (seg, k) {
        if (!seg.paths || seg.paths.length < 2) return;
        var col = MODE_COLOR[seg.mode] || MODE_COLOR.auto;
        lineOverlays.push(new AMap.Polyline({
          map: map, path: seg.paths,
          strokeColor: col, strokeWeight: 14, strokeOpacity: 0.14,
          lineJoin: 'round', lineCap: 'round', zIndex: 38
        }));
        lineOverlays.push(new AMap.Polyline({
          map: map, path: seg.paths,
          strokeColor: col, strokeWeight: 6, strokeOpacity: seg.estimated ? 0.8 : 0.95,
          strokeStyle: seg.estimated ? 'dashed' : 'solid',
          isOutline: true, outlineColor: '#ffffff', borderWeight: 1.5,
          showDir: true, lineJoin: 'round', lineCap: 'round',
          zIndex: 40
        }));
      });
    });
    syncFlow();
  }

  /* ---------- 行车动画 ---------- */
  var flowRAF = null, flowPaths = [], flowLastTs = 0, flowSig = '';

  function buildFlowPaths() {
    var out = [];
    trip.days.forEach(function (d, i) {
      if (i !== activeDay) return;
      var r = routeCache[i];
      if (!r || !r.segments.length) return;
      var pts = [], cum = [], acc = 0, stopDists = [], segModes = [], tSum = 0, dSum = 0;
      r.segments.forEach(function (seg, k) {
        if (!seg.paths || seg.paths.length < 2) return;
        var m = MODE_META[seg.mode] || MODE_META.car;
        var segStart = acc;
        for (var j = (k === 0 ? 0 : 1); j < seg.paths.length; j++) {
          var p = seg.paths[j];
          if (pts.length) {
            acc += haversine(
              { lat: pts[pts.length - 1][1], lng: pts[pts.length - 1][0] },
              { lat: p[1], lng: p[0] });
          }
          pts.push(p); cum.push(acc);
        }
        var segLen = acc - segStart;
        stopDists.push(acc);
        segModes.push({ end: acc, mode: seg.mode || 'car' });
        tSum += segLen / 1000 * m.k;
        dSum += segLen;
      });
      if (pts.length < 2 || acc <= 0) return;
      var avgK = dSum > 0 ? tSum / (dSum / 1000) : MODE_META.car.k;
      /* 播放时长（2026-09-28 方案 B）：≤12s 的短天按里程原样；超过 12s 的长天
         用平方根压缩（12 + 0.5×√超出），越长的天越明显提速（Day2 约 20s→15s），
         且保留「里程越长播放越久一点」的次序感。 */
      var raw = dSum / 1000 * avgK;
      var sec = raw <= 12 ? clamp(raw, 4, 12) : 12 + Math.sqrt(raw - 12) * 0.5;
      out.push({
        day: i, pts: pts, cum: cum, total: acc, stopDists: stopDists, segModes: segModes,
        dist: 0, pausing: 0, nextStop: 0, restart: false, speed: acc / sec
      });
    });
    return out;
  }
  function flowModeAt(fp, d) {
    var sm = fp.segModes || [];
    for (var i = 0; i < sm.length; i++) if (d <= sm[i].end) return sm[i].mode;
    return sm.length ? sm[sm.length - 1].mode : 'car';
  }
  function flowPosAt(fp, d) {
    var pts = fp.pts, cum = fp.cum;
    if (d <= 0) return pts[0];
    if (d >= fp.total) return pts[pts.length - 1];
    var lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1; else hi = mid;
    }
    var i = Math.max(1, lo);
    var d0 = cum[i - 1], d1 = cum[i];
    var t = (d1 - d0) ? (d - d0) / (d1 - d0) : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
            pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }
  function flowAngleAt(fp, d) {
    var d2 = Math.min(d + 5, fp.total);
    var p1 = flowPosAt(fp, d), p2 = flowPosAt(fp, d2);
    var dLng = p2[0] - p1[0], dLat = p2[1] - p1[1];
    if (Math.abs(dLng) < 1e-9 && Math.abs(dLat) < 1e-9) return null;
    var midLat = (p1[1] + p2[1]) / 2 * Math.PI / 180;
    return Math.atan2(dLng * Math.cos(midLat), dLat) * 180 / Math.PI;
  }
  function ensureFlowMarker(p, mode, angle) {
    if (!flowMarker) {
      flowMarker = new AMap.Marker({
        map: map, position: new AMap.LngLat(p[0], p[1]),
        anchor: 'center', content: vehImg(mode), zIndex: 150, offset: new AMap.Pixel(0, 0)
      });
      flowCurMode = mode;
    } else {
      flowMarker.setPosition(new AMap.LngLat(p[0], p[1]));
      if (mode !== flowCurMode) { flowMarker.setContent(vehImg(mode)); flowCurMode = mode; }
    }
    /* car 用实车照片（斜前视角），旋转会穿帮；方向感由路线的 showDir 箭头承担 */
    if (typeof flowMarker.setAngle === 'function') {
      flowMarker.setAngle(0);
    }
  }
  function flowTick(ts) {
    if (!flowPaths.length) { flowRAF = null; return; }
    if (!flowLastTs) flowLastTs = ts;
    var dt = Math.min(120, ts - flowLastTs);
    flowLastTs = ts;
    flowPaths.forEach(function (fp) {
      if (fp.pausing) {
        fp.pausing -= dt;
        if (fp.pausing <= 0) {
          fp.pausing = 0;
          if (fp.dist >= fp.total) { fp.dist = 0; fp.nextStop = 0; }   // 循环：重头开始，每个点恢复停顿
        }
        ensureFlowMarker(flowPosAt(fp, fp.dist), flowModeAt(fp, fp.dist), flowAngleAt(fp, fp.dist));
        return;
      }
      fp.dist += fp.speed * (dt / 1000);
      if (fp.dist >= fp.total) {
        fp.dist = fp.total;
        fp.pausing = (MODE_META[flowModeAt(fp, fp.dist)] || MODE_META.car).pause;
      } else if (fp.nextStop < fp.stopDists.length && fp.dist >= fp.stopDists[fp.nextStop]) {
        fp.pausing = (MODE_META[flowModeAt(fp, fp.dist)] || MODE_META.car).pause;
        fp.nextStop++;
      }
      ensureFlowMarker(flowPosAt(fp, fp.dist), flowModeAt(fp, fp.dist), flowAngleAt(fp, fp.dist));
    });
    flowRAF = window.requestAnimationFrame(flowTick);
  }
  function stopFlow() {
    if (flowRAF) { window.cancelAnimationFrame(flowRAF); flowRAF = null; }
    flowPaths = []; flowLastTs = 0; flowSig = '';
    if (flowMarker) { map.remove(flowMarker); flowMarker = null; flowCurMode = ''; }
  }
  function syncFlow() {
    var sig = activeDay + '|' +
      trip.days.map(function (d, i) {
        var r = routeCache[i];
        return i + ':' + d.stops.map(function (s) { return s.id; }).join(',') +
          ':' + (r ? r.segments.length : -1);
      }).join('|');
    if (sig === flowSig && flowRAF) return;
    stopFlow();
    flowPaths = buildFlowPaths();
    if (!flowPaths.length) return;
    flowSig = sig;
    flowLastTs = 0;
    flowRAF = window.requestAnimationFrame(flowTick);
  }

  function fitTo(points) {
    if (!points || !points.length) return;
    var lats = points.map(function (p) { return p.lat; });
    var lngs = points.map(function (p) { return p.lng; });
    var minLa = Math.min.apply(null, lats), maxLa = Math.max.apply(null, lats);
    var minLo = Math.min.apply(null, lngs), maxLo = Math.max.apply(null, lngs);
    if (minLa === maxLa && minLo === maxLo) {
      map.setZoomAndCenter(14, [minLo, minLa]); return;
    }
    var padLa = Math.max((maxLa - minLa) * 0.15, 0.01);
    var padLo = Math.max((maxLo - minLo) * 0.15, 0.01);
    var bounds = new AMap.Bounds([minLo - padLo, minLa - padLa], [maxLo + padLo, maxLa + padLa]);
    if (typeof map.setBounds === 'function') map.setBounds(bounds);
    else map.setFitView(stopMarkers.concat(lineOverlays), false, [70, 70, 70, 70]);
  }

  function renderAll() {
    renderTabs(); renderCards(); renderMarkers(); renderLines();
    if (!importing) save();
  }

  /* ---------- 目的地 ---------- */
  function geoLocate(name) {
    return new Promise(function (resolve, reject) {
      getGeocoder().getLocation(name, function (status, result) {
        var g = status === 'complete' && result && result.geocodes && result.geocodes[0];
        if (g && g.location) resolve({ lat: g.location.lat, lng: g.location.lng });
        else reject(new Error('no'));
      });
    });
  }

  /* ---------- 攻略解析 ---------- */
  function guessCity(str) {
    var m = String(str || '').match(/[-—·|]\s*([\u4e00-\u9fa5]{2,4}?)\s*(?=\d|市|亲子|攻略|三天|两日|$)/);
    if (m) return m[1];
    for (var i = 0; i < HOT_CITIES.length; i++) if (String(str).indexOf(HOT_CITIES[i]) >= 0) return HOT_CITIES[i];
    return '';
  }

  /* 解析单个攻略视图：权威 = 距离表 .rgroup[data-stops]；
     兼容旧 p.day-route；两者都没有（老攻略）回退时间线解析 */
  function parseOneView(viewEl) {
    var title = ((viewEl.querySelector('h1') || {}).textContent || '').trim();
    var days = parseDistTable(viewEl);
    if (!days.length) days = parseLegacyFlow(viewEl);
    var src = days.length ? 'distance-table' : 'timeline';
    if (!days.length) days = parseDetailDays(viewEl);
    var slug = viewEl.getAttribute('data-view') || '';
    return {
      slug: slug, title: title,
      city: guessCity(slug) || guessCity(title),
      days: days, source: src,
      coordIndex: extractPoiCoords(viewEl)
    };
  }

  /* 解析攻略 HTML（文件/链接导入） */
  function parseGuideHtml(html, slug) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var views = doc.querySelectorAll('[data-view]'), list = [];
    for (var i = 0; i < views.length; i++) {
      var v = views[i], s = v.getAttribute('data-view') || '';
      if (s === 'home' || v.id === 'v-home') continue;
      if (slug && s !== slug) continue;
      var g = parseOneView(v);
      if (g.days.length) list.push(g);
    }
    if (!list.length && slug) {
      list = [];
      var views2 = doc.querySelectorAll('[data-view]');
      for (var j = 0; j < views2.length; j++) {
        if ((views2[j].getAttribute('data-view') || '') === 'home') continue;
        var g2 = parseOneView(views2[j]);
        if (g2.days.length) list.push(g2);
      }
    }
    if (!list.length) {
      var root = doc.body || doc;
      var days = parseDistTable(root);
      if (!days.length) days = parseLegacyFlow(root);
      if (days.length) {
        var title = (doc.title || ((doc.querySelector('h1') || {}).textContent || '')).replace(/\s+/g, ' ').trim();
        list = [{
          slug: '', title: title,
          city: guessCity(slug) || guessCity(title) || guessCity((root.textContent || '').slice(0, 3000)),
          days: days, source: 'distance-table',
          coordIndex: extractPoiCoords(root)
        }];
      }
    }
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var names = list.map(function (g, i2) { return (i2 + 1) + '. ' + (g.title || g.slug); }).join('\n');
    var pick = window.prompt('这份文件里有 ' + list.length + ' 篇攻略，输入要导入的序号：\n' + names, '1');
    var n = parseInt(pick, 10);
    if (!n || n < 1 || n > list.length) return null;
    return list[n - 1];
  }

  /* 单点坐标解析（三级兜底）：① 城市限定关键词搜索 → ② 全国关键词搜索 → ③ 地理编码 */
  function acSearch(name, city, limit) {
    return new Promise(function (resolve) {
      var ac = new AMap.AutoComplete({ city: city || '全国', citylimit: !!limit });
      ac.search(name, function (status, result) {
        var tips = (status === 'complete' && result && result.tips) || [];
        var tip = tips.filter(function (t) {
          return t && t.location && typeof t.location.lng === 'number';
        })[0];
        resolve(tip ? { name: name, address: tip.address || tip.district || tip.name || '', lat: tip.location.lat, lng: tip.location.lng } : null);
      });
    });
  }
  function geocodeOne(name, cityName) {
    return acSearch(name, cityName, true)
      .then(function (hit) { return hit || acSearch(name, '', false); })
      .then(function (hit) {
        if (hit) return hit;
        return new Promise(function (resolve) {
          getGeocoder().getLocation(name, function (status, result) {
            var g = status === 'complete' && result && result.geocodes && result.geocodes[0];
            resolve(g && g.location ? { name: name, address: (g.formatted_address || g.address || name), lat: g.location.lat, lng: g.location.lng } : null);
          });
        });
      });
  }

  /* 导入攻略：坐标优先复用攻略「景点速查」自带值，匹配不到的才联网解析 */
  function importParsed(parsed) {
    var cityName = (parsed.city || (trip.city && trip.city.name) || '南昌').trim();
    var days = (parsed.days || []).filter(function (d) { return d && d.stops && d.stops.length >= 2; });
    if (!days.length) {
      elRouteHint.innerHTML = '<span class="hint err">这篇攻略里没识别出行程流水（需要「六、行程距离表」带 data-stops 或每日详细行程）。</span>';
      return Promise.resolve();
    }
    var idx = parsed.coordIndex || [];
    importing = true;

    function locateCity2(name) {
      return geoLocate(name).catch(function () {
        var inferred = '';
        for (var i = 0; i < idx.length && !inferred; i++) inferred = cityFromAddr(idx[i].raw);
        if (inferred && inferred !== name) {
          return geoLocate(inferred).then(function (loc) { return { name: inferred, loc: loc }; });
        }
        throw new Error('city');
      });
    }
    elRouteStatus.textContent = '正在定位「' + cityName + '」…';
    return locateCity2(cityName).then(function (r) {
      var loc = r && r.loc ? r.loc : r;
      var cname = (r && r.name) ? r.name : cityName;
      cityName = cname;
      trip.city = { name: cname, lat: loc.lat, lng: loc.lng };
      map.setZoomAndCenter(11, [loc.lng, loc.lat]);
      var total = days.reduce(function (n, d) { return n + d.stops.length; }, 0);
      elRouteStatus.textContent = '识别到 ' + days.length + ' 天 / ' + total + ' 个地点，正在解析坐标…';

      var resolved = [], miss = [], reuseN = 0, netN = 0, di = 0;
      function hint(msg) { elRouteStatus.textContent = msg; }
      function nextDay() {
        if (di >= days.length) return Promise.resolve();
        var dayObj = days[di], out = [], k = 0, dayNo = di; di++;
        function nextStop() {
          if (k >= dayObj.stops.length) { resolved[dayNo] = out; return Promise.resolve(); }
          var it = dayObj.stops[k], seg = (dayObj.segs && dayObj.segs[k - 1]) || null, kk = k++;
          var nm = it.name || String(it);
          var hit = matchSpot(nm, idx) || (it.raw && it.raw !== nm ? matchSpot(it.raw, idx) : null);
          var mode = seg && seg.mode ? seg.mode : 'auto';
          var planned = seg && seg.planned ? seg.planned : '';
          var dist = seg && seg.dist ? seg.dist : null;
          function done(lat, lng, addr) {
            var t = it.type || 'attraction';
            out.push({
              id: uid(), name: nm, address: addr || '', lat: lat, lng: lng, type: t,
              stay: it.stay || (TYPE_META[t] || TYPE_META.other).stay,
              modeFrom: mode, planned: planned, dist: dist,
              manual: (lat === null || lat === undefined)
            });
            return nextStop();
          }
          var ov = overrides[nm] || (it.raw && overrides[it.raw]);
          if (ov && typeof ov.lat === 'number' && typeof ov.lng === 'number') {
            reuseN++;
            hint('套用手动修正坐标（Day ' + (dayNo + 1) + '）：' + nm);
            return Promise.resolve(done(ov.lat, ov.lng, '（手动定位）'));
          }
          if (it.coord && typeof it.coord.lat === 'number' && typeof it.coord.lng === 'number') {
            reuseN++;
            hint('复用第六章内置坐标（Day ' + (dayNo + 1) + '）：' + nm);
            return Promise.resolve(done(it.coord.lat, it.coord.lng, '（第六章坐标）'));
          }
          if (hit) {
            reuseN++;
            hint('复用攻略坐标（Day ' + (dayNo + 1) + '）：' + nm);
            return Promise.resolve(done(hit.lat, hit.lng, hit.raw));
          }
          hint('联网解析（Day ' + (dayNo + 1) + '）：' + nm);
          return geocodeOne(nm, cityName).then(function (p) {
            if (p) { netN++; return done(p.lat, p.lng, p.address); }
            miss.push(nm);
            return done(null, null, '');
          });
        }
        return nextStop().then(nextDay);
      }
      return nextDay().then(function () {
        stopFlow();
        routeCache = {};
        trip.title = parsed.title || trip.title;
        trip.days = resolved.map(function (arr, ai) {
          var dayMeta = days[ai] || {};
          return { title: dayMeta.title || ('Day ' + (ai + 1)), stops: arr, segs: (dayMeta.segs || []).slice(0, Math.max(arr.length - 1, 0)) };
        }).filter(function (d) { return d.stops.length >= 2; });
        trip.source = parsed.source || '';
        activeDay = clamp(bootDayIdx(), 0, Math.max(trip.days.length - 1, 0));
        elTripLabel.textContent = trip.title || '';
        renderAll();
        importing = false;
        save();
        return Promise.resolve(showDay(activeDay, { force: true })).then(function () {
          if (miss.length) {
            elRouteHint.innerHTML = '<span class="hint err">' + miss.length + ' 个地点未能自动定位，请点击「手动定位」在地图上标注：' +
              escapeHtml(miss.slice(0, 3).join('、')) + (miss.length > 3 ? '…' : '') + '</span>';
          } else {
            elRouteHint.innerHTML = '';
          }
        });
      });
    }).catch(function () {
      importing = false;
      /* 定位/联网失败别把页面清空：有上次缓存就按缓存渲染 */
      if (trip.days.length && trip.city) {
        elRouteHint.innerHTML = guideLinkHtml(trip.guideSlug) +
          '<span class="hint err">网络不通，先按上次缓存的路线显示</span>';
        renderAll();
        if (trip.days[activeDay] && trip.days[activeDay].stops.length >= 2) {
          planDay(activeDay).then(function () { showDay(activeDay); });
        }
        return;
      }
      elRouteStatus.textContent = '导入失败：城市定位不成功，请确认攻略页正常后再试。';
    });
  }

  /* ---------- 规划：逐段按距离表指定的方式 ---------- */
  function inferMode(approxMeters) {
    if (approxMeters <= 1500) return 'walk';
    if (approxMeters <= 6000) return 'bike';
    if (approxMeters <= 25000) return 'bus';
    return 'car';
  }
  function planDay(dayIdx) {
    var stops = trip.days[dayIdx].stops;
    if (stops.length < 2) { delete routeCache[dayIdx]; return Promise.resolve(); }
    var chain = Promise.resolve();
    var segs = [], totalD = 0, totalT = 0, est = 0;
    for (var k = 1; k < stops.length; k++) {
      (function (ki) {
        var a = stops[ki - 1], b = stops[ki];
        var hasNull = a.lat === null || a.lat === undefined || b.lat === null || b.lat === undefined;
        var approx = hasNull ? 0 : haversine(a, b) * 1.3;
        var mode = b.modeFrom && b.modeFrom !== 'auto' ? b.modeFrom : inferMode(approx);
        chain = chain.then(function () {
          if (hasNull) {
            segs.push({ from: a.id, to: b.id, mode: mode, distance: 0, duration: 0, paths: [], estimated: true });
            return;
          }
          return planSegment(a, b, mode).then(function (seg) {
            seg.from = a.id; seg.to = b.id; seg.mode = mode;
            totalD += seg.distance; totalT += seg.duration;
            if (seg.estimated) est += 1;
            segs.push(seg);
          });
        });
      })(k);
    }
    return chain.then(function () {
      routeCache[dayIdx] = { segments: segs, totalDistance: totalD, totalDuration: totalT, estCount: est };
    });
  }

  function segCountOf(r) { return r.segments.length; }

  function collectPath(r) {
    var out = [];
    /* 单段点序列：支持 "lng,lat;lng,lat" 字符串、[[lng,lat],…]、LngLat 数组 */
    function absorb(p) {
      if (!p) return;
      if (typeof p === 'string') {
        p = p.split(';').map(function (s) { var xy = s.split(','); return [+xy[0], +xy[1]]; });
      }
      if (!p || !p.length) return;
      for (var i = 0; i < p.length; i++) {
        var q = toLngLatArr(p[i]);
        if (q && (!out.length || out[out.length - 1][0] !== q[0] || out[out.length - 1][1] !== q[1])) out.push(q);
      }
    }
    var groups = (r && (r.steps || r.segments)) || [];
    groups.forEach(function (st) {
      /* 驾车/步行/骑行：每个 step 直接带 path */
      absorb(st.path);
      if (st.steps && st.steps.length) {
        for (var s = 0; s < st.steps.length; s++) absorb(st.steps[s] && st.steps[s].path);
      }
      /* 🔴 公交/地铁（Transfer）的路径藏在 transit 里：
         transit_mode=WALK 时是 transit.steps[].path，SUBWAY/BUS 时是 transit.path。
         取不到就会回退成驾车路线（曾经「地铁优先，图上却全是开车的路」）。 */
      if (st.transit) {
        absorb(st.transit.path);
        if (st.transit.steps && st.transit.steps.length) {
          for (var t = 0; t < st.transit.steps.length; t++) absorb(st.transit.steps[t] && st.transit.steps[t].path);
        }
      }
      /* 兼容另外两种可能的结构 */
      if (st.walking && st.walking.path) absorb(st.walking.path);
      if (st.walking && st.walking.steps && st.walking.steps.length) {
        for (var w = 0; w < st.walking.steps.length; w++) absorb(st.walking.steps[w] && st.walking.steps[w].path);
      }
      if (st.buslines && st.buslines.length) {
        for (var b = 0; b < st.buslines.length; b++) absorb(st.buslines[b] && st.buslines[b].path);
      }
    });
    return out;
  }
  function toLngLatArr(q) {
    if (!q) return null;
    if (Array.isArray(q)) return (isFinite(q[0]) && isFinite(q[1])) ? [q[0], q[1]] : null;
    if (typeof q.lng === 'number' && typeof q.lat === 'number') return [q.lng, q.lat];
    if (typeof q.getLng === 'function') return [q.getLng(), q.getLat()];
    return null;
  }
  function routeService(mode) {
    var A = window.AMap;
    if (mode === 'walk' && A.Walking) return new A.Walking();
    if (mode === 'bike' && A.Riding) return new A.Riding();
    if ((mode === 'bus' || mode === 'metro') && A.Transfer && trip.city) return new A.Transfer({ city: trip.city.name });
    if (mode !== 'car') console.warn('[route] ' + mode + ' service unavailable, using Driving');
    return getDriving();
  }
  function amapSearch(svc, a, b) {
    return new Promise(function (resolve, reject) {
      svc.search(new AMap.LngLat(a.lng, a.lat), new AMap.LngLat(b.lng, b.lat), function (status, result) {
        /* 失败时把高德的原因带上（如 CUQPS_HAS_EXCEEDED_THE_LIMIT 限流），方便排查 */
        if (status === 'complete') resolve(result);
        else reject(new Error((status || 'no_data') + (result && result.info ? ' / ' + result.info : '')));
      });
    });
  }
  function extractRoute(res) {
    if (!res) return null;
    if (res.routes && res.routes[0]) return res.routes[0];
    if (res.plans && res.plans[0]) return res.plans[0];
    return null;
  }
  /* ---------- Transfer 完整换乘规划：bus 的主路径、metro 的兜底 ---------- */
  function planTransferSeg(a, b) {
    if (!(window.AMap.Transfer && trip.city)) return straightSeg(a, b);
    return amapSearch(routeService('metro'), a, b).then(function (res) {
      var r = extractRoute(res);
      if (!r) throw new Error('empty');
      var pts = downsample(collectPath(r), 180);
      if (pts.length < 2) throw new Error('nopath');
      /* Transfer 的 plan 往往不带 distance：用换乘段之和，再不行按路径长度兜底 */
      var dist = r.distance || 0;
      if (!dist && r.segments && r.segments.length) {
        for (var si = 0; si < r.segments.length; si++) dist += (r.segments[si].distance || 0);
      }
      if (!dist) {
        for (var pi = 1; pi < pts.length; pi++) {
          dist += haversine({ lat: pts[pi - 1][1], lng: pts[pi - 1][0] }, { lat: pts[pi][1], lng: pts[pi][0] });
        }
      }
      return { distance: dist, duration: r.time || 0, paths: pts, estimated: false };
    }).catch(function (err) {
      console.warn('[route] transfer plan failed, drawing estimated dashed line:',
        err && err.message ? err.message : err);
      return straightSeg(a, b);
    });
  }

  /* 🔴 公交规划失败绝不能拿驾车路线冒充：驾车路径走马路，画出来就是
     「公交线沿着大马路跑」。bus 失败 → 换全新规划器重试（planTransferSeg 内部
     每次都 new Transfer）→ 仍失败画虚线直线并计入「估算」。 */
  function nearestMetroStation(ll) {
    var A = window.AMap;
    return new Promise(function (resolve) {
      if (!A.PlaceSearch || !trip.city) return resolve(null);
      var ps = new A.PlaceSearch({ city: trip.city.name, citylimit: true, type: '地铁站', pageSize: 10, pageIndex: 1 });
      ps.searchNearBy('', [ll.lng, ll.lat], 5000, function (status, res) {
        try {
          if (status !== 'complete' || !res || !res.poiList || !res.poiList.pois || !res.poiList.pois.length) return resolve(null);
          resolve(res.poiList.pois[0]);   /* searchNearBy 按距离由近到远，取最近一个 */
        } catch (e) { resolve(null); }
      });
    });
  }
  function llOf(loc) {
    if (!loc) return null;
    if (typeof loc.getLng === 'function') return { lng: loc.getLng(), lat: loc.getLat() };
    if (Array.isArray(loc)) return { lng: +loc[0], lat: +loc[1] };
    return { lng: +loc.lng, lat: +loc.lat };
  }
  /* 🚇 地铁段的画法（2026-09-28 v2「锚定车站」方案）：
     S1=离起点最近的地铁站、S2=离终点最近的地铁站，然后三段拼接——
       ① 起点 →步行导航→ S1   ② S1 →Transfer(站到站)→ S2（走真实地铁线）
       ③ S2 →步行导航→ 终点
     站到站规划比任意点对点可靠得多（首末步行短、且必然沿地铁线路画），
     这就是「更好的地铁导航获取方法」。兜底：
     · 两头都找不到站 → 完整 Transfer（planTransferSeg）
     · 只有一头有站 / S1、S2 是同一站 → 起点进站、出站到终点，两段步行
     · 站到站 Transfer 失败 → S1—S2 虚线直线（地铁在地下，估算合理）
     · 某段步行失败 → 该段直线估算 */
  function stripStation(name) { return (name || '').replace(/地铁站$/, ''); }
  function sameStation(s1, s2, p1, p2) {
    if (s1 && s2 && s1.uid && s2.uid && s1.uid === s2.uid) return true;
    if (s1 && s2 && s1.name && s1.name === s2.name) return true;
    return haversine(p1, p2) < 200;
  }
  function walkLeg(from, to) {
    return amapSearch(routeService('walk'), from, to).then(function (res) {
      var r = extractRoute(res);
      if (!r) throw new Error('empty');
      var pts = downsample(collectPath(r), 180);
      if (pts.length < 2) throw new Error('nopath');
      var dist = r.distance || 0;
      if (!dist) {
        for (var pi = 1; pi < pts.length; pi++) {
          dist += haversine({ lat: pts[pi - 1][1], lng: pts[pi - 1][0] }, { lat: pts[pi][1], lng: pts[pi][0] });
        }
      }
      return { distance: dist, time: r.time || 0, paths: pts, estimated: false };
    }).catch(function (err) {
      console.warn('[route] walk leg failed:', err && err.message ? err.message : err);
      return null;
    });
  }
  /* 站到站的地铁乘车段：Transfer 沿真实地铁线路画；失败则虚线直线估算 */
  function planRide(p1, p2) {
    var d = haversine(p1, p2) * 1.2;
    if (!(window.AMap.Transfer && trip.city)) {
      return Promise.resolve({ distance: d, time: d / 1000 / 35 * 3600, paths: [[p1.lng, p1.lat], [p2.lng, p2.lat]], estimated: true });
    }
    return amapSearch(routeService('metro'), p1, p2).then(function (res) {
      var r = extractRoute(res);
      if (!r) throw new Error('empty');
      var pts = downsample(collectPath(r), 180);
      if (pts.length < 2) throw new Error('nopath');
      var dist = r.distance || 0;
      if (!dist && r.segments && r.segments.length) {
        for (var si = 0; si < r.segments.length; si++) dist += (r.segments[si].distance || 0);
      }
      if (!dist) {
        for (var pi = 1; pi < pts.length; pi++) {
          dist += haversine({ lat: pts[pi - 1][1], lng: pts[pi - 1][0] }, { lat: pts[pi][1], lng: pts[pi][0] });
        }
      }
      return { distance: dist, time: r.time || 0, paths: pts, estimated: false };
    }).catch(function (err) {
      console.warn('[route] metro ride S1→S2 failed, dashed straight estimate:', err && err.message ? err.message : err);
      return { distance: d, time: d / 1000 / 35 * 3600, paths: [[p1.lng, p1.lat], [p2.lng, p2.lat]], estimated: true };
    });
  }
  function assembleLegs(legs, fallback) {
    var paths = [], dist = 0, time = 0, est = false;
    for (var i = 0; i < legs.length; i++) {
      var L = legs[i];
      if (!L) { est = true; continue; }
      if (L.paths && L.paths.length) paths = paths.concat(L.paths);
      dist += L.distance; time += L.time;
      if (L.estimated) est = true;
    }
    if (paths.length < 2) return fallback;
    return { distance: dist, duration: time, paths: downsample(paths, 180), estimated: est };
  }
  function planMetroSeg(a, b) {
    return Promise.all([nearestMetroStation(a), nearestMetroStation(b)]).then(function (ps) {
      var s1 = ps[0], s2 = ps[1];
      var p1 = s1 && llOf(s1.location), p2 = s2 && llOf(s2.location);
      if (!p1 && !p2) return planTransferSeg(a, b);      /* 两头都没有地铁站：完整换乘兜底 */
      if (!p1 || !p2 || sameStation(s1, s2, p1, p2)) {
        /* 一头没站 / 同一站进出：起点→站、站→终点 两段步行 */
        var mid = p1 || p2, via = stripStation((p1 ? s1 : s2).name);
        return Promise.all([walkLeg(a, mid), walkLeg(mid, b)]).then(function (ls) {
          if (!ls[0] && !ls[1]) return planTransferSeg(a, b);
          var r = assembleLegs(ls, null);
          if (!r) return planTransferSeg(a, b);
          r.via = via;
          return r;
        });
      }
      /* 标准三段：步行进站 → 地铁（站到站）→ 步行出站 */
      return Promise.all([walkLeg(a, p1), planRide(p1, p2), walkLeg(p2, b)]).then(function (ls) {
        if (!ls[0] && !ls[1] && !ls[2]) return planTransferSeg(a, b);
        var r = assembleLegs(ls, null);
        if (!r) return planTransferSeg(a, b);
        r.via = stripStation(s1.name);
        return r;
      });
    });
  }

  /* 解析一次规划结果 → 线段对象（驾车/步行/骑行通用） */
  function parseSegRes(res, mode) {
    var r = extractRoute(res);
    if (!r) { console.warn('[route] no route in response', mode, res); throw new Error('empty'); }
    var pts = downsample(collectPath(r), 180);
    if (pts.length < 2) { console.warn('[route] no path points', mode, r); throw new Error('nopath'); }
    /* Transfer 的 plan 往往不带 distance：用换乘段之和，再不行按路径长度兜底 */
    var dist = r.distance || 0;
    if (!dist && r.segments && r.segments.length) {
      for (var si = 0; si < r.segments.length; si++) dist += (r.segments[si].distance || 0);
    }
    if (!dist) {
      for (var pi = 1; pi < pts.length; pi++) {
        dist += haversine({ lat: pts[pi - 1][1], lng: pts[pi - 1][0] }, { lat: pts[pi][1], lng: pts[pi][0] });
      }
    }
    return { distance: dist, duration: r.time || 0, paths: pts, estimated: false };
  }
  /* 全新规划器（重试用）：drivingSvc 是缓存单例，状态坏了复用会一直失败 */
  function freshSvc(mode) {
    var A = window.AMap;
    if (mode === 'walk' && A.Walking) return new A.Walking();
    if (mode === 'bike' && A.Riding) return new A.Riding();
    return new A.Driving({ policy: (window.AMap.DrivingPolicy || {}).LEAST_TIME || 0 });
  }
  function planSegment(a, b, mode) {
    /* 🚇 地铁段（2026-09-28 需求）：起点步行到最近地铁站 + 步行到目的地，
       不画完整换乘（完整方案作为兜底，见 planMetroSeg）。 */
    if (mode === 'metro') return planMetroSeg(a, b);
    var svc = routeService(mode);
    return amapSearch(svc, a, b)
      .then(function (res) { return parseSegRes(res, mode); })
      .catch(function (err) {
        console.warn('[route] ' + mode + ' search failed:', err && err.message ? err.message : err);
        if (mode === 'bus') return planTransferSeg(a, b);
        /* 🔴 限流 / 网络抖动这类瞬时失败也会发生：等 350ms 换全新规划器重试一次，
           仍失败才走兜底 —— 驾车段之前一次失败就直接画直线（Day2 摩天轮→酒店踩过）。 */
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(amapSearch(freshSvc(mode), a, b)); }, 350);
        }).then(function (res) {
          return parseSegRes(res, mode);
        }).catch(function (err2) {
          console.warn('[route] ' + mode + ' retry failed:', err2 && err2.message ? err2.message : err2);
          if (mode !== 'car') {
            return amapSearch(getDriving(), a, b).then(function (res) {
              return parseSegRes(res, mode);
            }).catch(function (err3) {
              console.warn('[route] driving fallback also failed:', err3 && err3.message ? err3.message : err3);
              return straightSeg(a, b);
            });
          }
          return straightSeg(a, b);
        });
      });
  }
  function straightSeg(a, b) {
    var d = haversine(a, b) * 1.35;
    return {
      distance: d, duration: d / 1000 / 30 * 3600,
      paths: [[a.lng, a.lat], [b.lng, b.lat]],
      estimated: true
    };
  }

  function showDay(i, opts) {
    if (typeof i === 'number') activeDay = clamp(i, 0, trip.days.length - 1);
    renderAll();
    var d = trip.days[activeDay];
    if (!d) return Promise.resolve();
    var pts = d.stops.filter(function (s) { return s.lat !== null && s.lat !== undefined; }).map(function (s) { return { lat: s.lat, lng: s.lng }; });
    if (d.stops.length < 2) {
      elRouteStatus.textContent = 'Day ' + (activeDay + 1) + ' 地点不足 2 个，未生成路线。';
      if (pts.length) fitTo(pts);
      return Promise.resolve();
    }
    if (!routeCache[activeDay] || (opts && opts.force)) return autoRoute(activeDay);
    fitTo(pts);
    var r = routeCache[activeDay];
    elRouteStatus.textContent = '正在显示 Day ' + (activeDay + 1) + '：共 ' + segCountOf(r) + ' 段 · ' +
      fmtKm(r.totalDistance) + ' · ' + fmtDur(r.totalDuration) +
      (segBreakdown(r) ? '（' + segBreakdown(r) + '）' : '') + (r.estCount ? ' · 含估算' : '');
    return Promise.resolve();
  }
  function autoRoute(dayIdx) {
    elRouteStatus.textContent = '正在连接 Day ' + (dayIdx + 1) + ' 的路线…';
    return planDay(dayIdx).then(function () {
      renderAll();
      var pts = trip.days[dayIdx].stops.filter(function (s) { return s.lat !== null && s.lat !== undefined; }).map(function (s) { return { lat: s.lat, lng: s.lng }; });
      if (pts.length) fitTo(pts);
      var r = routeCache[dayIdx];
      elRouteStatus.textContent = r
        ? '正在显示 Day ' + (dayIdx + 1) + '：共 ' + segCountOf(r) + ' 段 · ' + fmtKm(r.totalDistance) + ' · ' + fmtDur(r.totalDuration) + (segBreakdown(r) ? '（' + segBreakdown(r) + '）' : '') + (r.estCount ? ' · 含估算' : '')
        : 'Day ' + (dayIdx + 1) + ' 地点不足 2 个，未生成路线。';
    });
  }
  function segBreakdown(r) {
    if (!r || !r.segments.length) return '';
    var order = ['walk', 'bike', 'bus', 'metro', 'car'], cnt = {};
    r.segments.forEach(function (s) { var m = s.mode || 'car'; cnt[m] = (cnt[m] || 0) + 1; });
    return order.filter(function (m) { return cnt[m]; }).map(function (m) {
      return MODE_ICON[m] + cnt[m] + '段';
    }).join(' · ');
  }

  /* ---------- 事件 ---------- */
  if (elDayTabs) elDayTabs.addEventListener('click', function (e) {
    var t = e.target.closest('.day-tab'); if (!t) return;
    showDay(+t.dataset.day);
  });
  elDayCards.addEventListener('click', function (e) {
    /* 段交通方式切换按钮：改这段的方式 → 立即重新规划并持久化（modeMan 防止第六章覆盖） */
    var sm = e.target.closest('[data-setmode]');
    if (sm) {
      var di = +sm.getAttribute('data-day'), ji = +sm.getAttribute('data-j'), mv = sm.getAttribute('data-mode');
      var day = trip.days[di], stp = day && day.stops[ji];
      if (!stp || !mv || MODE_ORDER.indexOf(mv) < 0) return;
      if (stp.modeFrom === mv && routeCache[di]) return;
      stp.modeFrom = mv;
      stp.modeMan = true;
      if (day.segs[ji - 1]) { day.segs[ji - 1].mode = mv; day.segs[ji - 1].modeMan = true; }
      delete routeCache[di];
      save();
      elRouteStatus.textContent = '正在按' + (MODE_META[mv] || {}).label + '重新规划这一段…';
      planDay(di).then(function () {
        renderAll();
        var r = routeCache[di];
        if (r) elRouteStatus.textContent = '已更新：' + fmtKm(r.totalDistance) + ' · ' + fmtDur(r.totalDuration) + (r.estCount ? ' · 含估算' : '');
      });
      return;
    }
    var locBtn = e.target.closest('[data-locate]');
    if (locBtn) { startPicking(locBtn.dataset.locate); return; }
    var head = e.target.closest('.day-head[data-day]');
    if (head) { showDay(+head.dataset.day, { force: false }); return; }
    var el = e.target.closest('[data-goto]');
    if (!el) return;
    var f = findStopById(el.dataset.goto);
    if (f && f.stop.lat !== null && f.stop.lat !== undefined) fitTo([{ lat: f.stop.lat, lng: f.stop.lng }]);
  });

  /* ---------- 启动：只认攻略，无攻略显示引导 ---------- */
  function guideLinkHtml(slug) {
    if (!slug) return '';
    return '<a class="btn" href="#/' + slug + '" style="text-decoration:none">📄 去查看攻略</a>';
  }
  function renderEmpty(msg) {
    if (elDayTabs) elDayTabs.innerHTML = '';
    elDayCards.innerHTML = '<div class="panel"><div class="day-empty">' + msg + '</div></div>';
    elRouteStatus.textContent = '';
  }

  var GUIDE_SLUGS = ['nanchang-3d', 'anji-2d', 'xiangshan-3d'];
  var bootSlug = (window.__routeParams && window.__routeParams.guide) || trip.guideSlug || '';
  if (bootSlug && GUIDE_SLUGS.indexOf(bootSlug) < 0) bootSlug = '';

  if (bootSlug) {
    elBackGuide.setAttribute('href', '#/' + bootSlug);
    elBackGuide.style.display = '';
    /* 左上角「🧭 行程路线图」也指回来源攻略（从哪进、回哪去），而不是首页 */
    if (elBrand) elBrand.setAttribute('href', '#/' + bootSlug);
    trip.guideSlug = bootSlug;
    /* 优先复用已加载的攻略 DOM；否则自己 fetch（分享链接直达 / 刷新场景） */
    var viewEl = document.getElementById('v-' + bootSlug);
    if (viewEl && viewEl.querySelector('h1')) {
      var parsed = parseOneView(viewEl);
      parsed.title = parsed.title || bootSlug;
      lastHtml = viewEl.outerHTML || ''; lastSlug = bootSlug;
      importParsed(parsed);
    } else {
      elRouteHint.innerHTML = guideLinkHtml(bootSlug);
      renderEmpty('正在加载攻略…');
      fetch('views/' + bootSlug + '.html')
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (html) {
          var p = parseGuideHtml(html, bootSlug);
          if (!p || !p.days.length) { renderEmpty('这篇攻略里没识别出行程。'); return; }
          p.title = p.title || bootSlug;
          lastHtml = html; lastSlug = bootSlug;
          importParsed(p);
        })
        .catch(function () { renderEmpty('攻略加载失败，请回首页点进该篇再试「生成路线图」。'); });
    }
  } else if (trip.days.length && trip.city) {
    /* 上次查看的攻略路线缓存：直接恢复；顺带重试以前定位失败的点（多半是联网抽风） */
    elTripLabel.textContent = trip.title || '';
    (function retryMissed() {
      var missed = [];
      trip.days.forEach(function (d, i) {
        d.stops.forEach(function (s) {
          if ((s.lat === null || s.lat === undefined) && !overrides[s.name]) missed.push({ day: i, stop: s });
        });
      });
      if (!missed.length) return;
      var cityName = (trip.city && trip.city.name) || '';
      var n = 0, fixed = 0;
      function next() {
        if (n >= missed.length) {
          if (fixed) { save(); renderAll(); if (!importing) planDay(activeDay).then(function(){ renderAll(); }); }
          return;
        }
        var m = missed[n++];
        geocodeOne(m.stop.name, cityName).then(function (p) {
          if (p) {
            m.stop.lat = p.lat; m.stop.lng = p.lng; m.address = p.address || m.stop.address;
            m.stop.manual = false;
            delete routeCache[m.day]; fixed++;
          }
        }).then(next, next);
      }
      next();
    })();
    if (trip.guideSlug) {
      elBackGuide.setAttribute('href', '#/' + trip.guideSlug);
      elBackGuide.style.display = '';
      if (elBrand) elBrand.setAttribute('href', '#/' + trip.guideSlug);
    }
    elRouteHint.innerHTML = guideLinkHtml(trip.guideSlug);
    renderAll();
    function bootDay() {
      var d = trip.days[activeDay];
      if (!d || d.stops.length < 2) {
        if (d && d.stops.length) fitTo(d.stops.map(function (s) { return { lat: s.lat, lng: s.lng }; }));
        return;
      }
      if (routeCache[activeDay]) { showDay(activeDay); return; }
      elRouteStatus.textContent = '正在生成 Day ' + (activeDay + 1) + ' 的路线图…';
      planDay(activeDay).then(function () { showDay(activeDay); });
    }
    /* 恢复缓存的行程时，也用第六章校正一遍每段方式：
       否则旧缓存里存下的方式会把出行方式偏好锁死（曾出现「怎么切都是打车」）。 */
    if (trip.guideSlug) {
      guideHtmlOf(trip.guideSlug).then(function (html) {
        var ch = applyGuideModes(html, trip.guideSlug);
        if (ch) { routeCache = {}; stopFlow(); save(); renderAll(); }
      }).catch(function () { /* 离线：保持缓存 */ }).then(bootDay);
    } else {
      bootDay();
    }
  } else {
    elRouteHint.innerHTML = guideLinkHtml('nanchang-3d');
    renderEmpty('请从攻略页顶栏点「🧭 查看路线图」，或直接打开某篇攻略的路线：<br>' +
      '<a href="#/route?guide=nanchang-3d" style="color:var(--brand-dark);text-decoration:underline">南昌 3 日</a> · ' +
      '<a href="#/route?guide=anji-2d" style="color:var(--brand-dark);text-decoration:underline">安吉 2 日</a> · ' +
      '<a href="#/route?guide=xiangshan-3d" style="color:var(--brand-dark);text-decoration:underline">象山 3 日</a>');
  }
})();
