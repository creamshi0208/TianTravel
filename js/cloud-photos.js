/* cloud-photos.js —— 图集 tab「📷 我的旅拍」
   登录（仅邮箱）→ 选照片 → 前端压缩 → 传 WorkBuddy 云存储 shared/ → 全家登录后都能看。
   依赖：js/vendor/workbuddy-cloud-sdk.global.js（先加载）+ js/cloud-config.js + app-shell 的图集 tab。
   规则要点（来自云服务模块文档）：
   · 存储仅登录用户可用（无公开桶）；web 端只支持邮箱登录（密码 / 邮箱验证码）
   · auth 仅在应用注册的发布域名（creams.app.workbuddy.host）上可用，
     GitHub Pages / localhost 打开时给出跳转提示，不做降级假登录
   · 上传前压缩（长边 1280 / q0.72），路径 shared/<uid>/photos/<攻略id>/<时间戳>-<随机>.jpg
   · 展示用签名 URL（最长 1 小时），刷新页面重新取 */
(function () {
  'use strict';

  var CFG = window.WB_CLOUD || null;
  var RELEASE_HOST = 'creams.app.workbuddy.host';
  var UPLOAD_MAX_SIDE = 1280, UPLOAD_Q = 0.72, PAGE = 60;

  function sdkReady() { return !!(window.WorkBuddyCloud && CFG && CFG.endpoint && CFG.publishableKey); }

  var _cloud = null;
  function client() {
    if (!_cloud && sdkReady()) {
      _cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: CFG.endpoint,
        publishableKey: CFG.publishableKey
      });
    }
    return _cloud;
  }

  function onReleaseDomain() { return location.hostname === RELEASE_HOST; }
  function releaseLink(guideId) {
    return 'https://' + RELEASE_HOST + '/#' + (guideId ? '/' + guideId + '?tab=photos' : '/');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 图片压缩 ---------- */
  function compress(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type || '')) { reject(new Error('只支持图片文件')); return; }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * scale));
          cv.height = Math.max(1, Math.round(h * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob); else reject(new Error('图片压缩失败'));
          }, 'image/jpeg', UPLOAD_Q);
        } catch (err) { URL.revokeObjectURL(url); reject(err); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  /* ---------- 登录面板（密码 / 验证码登录 / 注册 / 忘记密码） ---------- */
  function renderLogin(root, guideId) {
    var onDomain = onReleaseDomain();
    root.innerHTML =
      '<div class="ap-tp-head"><span class="ap-tp-title">📷 我的旅拍</span></div>' +
      (onDomain ? '' :
        '<div class="ap-tp-warn">🔒 旅拍相册的登录和上传只在发布域名上开放：' +
        '<a href="' + esc(releaseLink(guideId)) + '">点此打开 → creams.app.workbuddy.host</a></div>') +
      '<div class="ap-tp-note">旅拍相册仅登录用户可看可传（家庭共享）。' +
      '本站只支持<b>邮箱登录</b>：第一次用「验证码登录 / 注册」，之后密码或验证码都行。</div>' +
      '<div class="ap-tp-forms">' +
      '<form class="ap-tp-form" data-f="pwd">' +
      '<h4>密码登录</h4>' +
      '<input type="email" name="email" placeholder="邮箱" autocomplete="email" required>' +
      '<input type="password" name="password" placeholder="密码" autocomplete="current-password" required>' +
      '<button type="submit" class="ap-tp-btn">登录</button>' +
      '<div class="ap-tp-err"></div>' +
      '<div class="ap-tp-links"><button type="button" data-g="otp">验证码登录 / 注册</button>' +
      '<button type="button" data-g="forgot">忘记密码</button></div>' +
      '</form>' +
      '<form class="ap-tp-form" data-f="otp" hidden>' +
      '<h4>验证码登录 / 注册</h4>' +
      '<input type="email" name="email" placeholder="邮箱" autocomplete="email" required>' +
      '<div class="ap-tp-row"><input type="text" name="code" placeholder="邮箱验证码" inputmode="numeric" autocomplete="one-time-code">' +
      '<button type="button" class="ap-tp-btn2" data-act="send">获取验证码</button></div>' +
      '<input type="password" name="password" placeholder="设置密码（新用户必填）" autocomplete="new-password">' +
      '<button type="submit" class="ap-tp-btn">验证并登录</button>' +
      '<div class="ap-tp-err"></div>' +
      '<div class="ap-tp-links"><button type="button" data-g="pwd">返回密码登录</button></div>' +
      '</form>' +
      '<form class="ap-tp-form" data-f="forgot" hidden>' +
      '<h4>重置密码</h4>' +
      '<input type="email" name="email" placeholder="邮箱" autocomplete="email" required>' +
      '<button type="button" class="ap-tp-btn2" data-act="reset-send">发送重置邮件</button>' +
      '<input type="text" name="code" placeholder="邮件里的验证码" inputmode="numeric">' +
      '<input type="password" name="password" placeholder="新密码" autocomplete="new-password">' +
      '<button type="submit" class="ap-tp-btn">设置新密码</button>' +
      '<div class="ap-tp-err"></div>' +
      '<div class="ap-tp-links"><button type="button" data-g="pwd">返回密码登录</button></div>' +
      '</form></div>';

    var pendingOtp = null;      /* { email, verificationId, isExistingUser } */
    var pendingReset = null;    /* updateUser 句柄 */
    var forms = root.querySelectorAll('.ap-tp-form');
    function show(name) {
      forms.forEach(function (f) { f.hidden = f.getAttribute('data-f') !== name; });
    }
    function err(form, msg) {
      var e = form.querySelector('.ap-tp-err');
      if (e) e.textContent = msg || '';
    }
    root.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-g]');
      if (g) { show(g.getAttribute('data-g')); return; }
    });

    /* 密码登录 */
    forms.forEach(function (form) {
      var f = form.getAttribute('data-f');
      form.addEventListener('submit', function (e) { e.preventDefault(); err(form, ''); });
    });
    var pwdForm = root.querySelector('[data-f="pwd"]');
    pwdForm.addEventListener('submit', function (e) {
      e.preventDefault(); err(pwdForm, '');
      var email = pwdForm.email.value.trim(), password = pwdForm.password.value;
      var btn = pwdForm.querySelector('.ap-tp-btn'); btn.disabled = true;
      client().auth.signInWithPassword({ email: email, password: password }).then(function (r) {
        btn.disabled = false;
        if (r.error) { err(pwdForm, r.error.message || '登录失败'); return; }
        refresh(root, guideId);
      }).catch(function () { btn.disabled = false; err(pwdForm, '网络异常，请重试'); });
    });

    /* 验证码：发送（存挑战）与提交（不再发码）严格分离 */
    var otpForm = root.querySelector('[data-f="otp"]');
    var sendBtn = otpForm.querySelector('[data-act="send"]');
    sendBtn.addEventListener('click', function () {
      err(otpForm, '');
      var email = otpForm.email.value.trim();
      if (!email) { err(otpForm, '请先填写邮箱'); return; }
      sendBtn.disabled = true;
      client().auth.sendOtp({ email: email }).then(function (r) {
        sendBtn.disabled = false;
        if (r.error) { err(otpForm, r.error.message || '验证码发送失败'); return; }
        pendingOtp = { email: email, verificationId: r.data.verificationId, isExistingUser: r.data.isExistingUser };
        err(otpForm, '验证码已发送到邮箱，请查收（注意垃圾箱）');
      }).catch(function () { sendBtn.disabled = false; err(otpForm, '网络异常，请重试'); });
    });
    otpForm.addEventListener('submit', function (e) {
      e.preventDefault(); err(otpForm, '');
      var pending = pendingOtp;
      var email = otpForm.email.value.trim();
      if (!pending || pending.email !== email) { err(otpForm, '请先针对当前邮箱「获取验证码」'); return; }
      var code = otpForm.code.value.trim();
      var password = otpForm.password.value;
      if (pending.isExistingUser && password) password = undefined;   /* 老用户验证码登录无需密码 */
      var btn = otpForm.querySelector('.ap-tp-btn'); btn.disabled = true;
      client().auth.verifyOtp({
        email: pending.email,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code,
        password: pending.isExistingUser ? undefined : password
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { err(otpForm, r.error.message || '验证失败'); return; }
        pendingOtp = null;
        refresh(root, guideId);
      }).catch(function () { btn.disabled = false; err(otpForm, '网络异常，请重试'); });
    });

    /* 忘记密码 */
    var fgForm = root.querySelector('[data-f="forgot"]');
    fgForm.querySelector('[data-act="reset-send"]').addEventListener('click', function () {
      err(fgForm, '');
      var email = fgForm.email.value.trim();
      if (!email) { err(fgForm, '请先填写邮箱'); return; }
      client().auth.resetPasswordForEmail(email).then(function (r) {
        if (r.error) { err(fgForm, r.error.message || '发送失败'); return; }
        pendingReset = r.data;
        err(fgForm, '重置邮件已发送，把验证码和新密码填进来');
      }).catch(function () { err(fgForm, '网络异常，请重试'); });
    });
    fgForm.addEventListener('submit', function (e) {
      e.preventDefault(); err(fgForm, '');
      if (!pendingReset) { err(fgForm, '请先「发送重置邮件」'); return; }
      var btn = fgForm.querySelector('.ap-tp-btn'); btn.disabled = true;
      pendingReset.updateUser({
        nonce: fgForm.code.value.trim(),
        password: fgForm.password.value
      }).then(function (r) {
        btn.disabled = false;
        if (r.error) { err(fgForm, r.error.message || '重置失败'); return; }
        pendingReset = null;
        refresh(root, guideId);
      }).catch(function () { btn.disabled = false; err(fgForm, '网络异常，请重试'); });
    });
  }

  /* ---------- 相册 ---------- */
  function renderGallery(root, guideId, session) {
    var uid = session.user.id;
    root.innerHTML =
      '<div class="ap-tp-head">' +
      '<span class="ap-tp-title">📷 我的旅拍</span>' +
      '<span class="ap-tp-count" id="ap-tp-count"></span>' +
      '<span class="ap-tp-gap"></span>' +
      '<button type="button" class="ap-tp-btn2" data-a="refresh">刷新</button>' +
      '<button type="button" class="ap-tp-btn2" data-a="signout">退出</button>' +
      '</div>' +
      '<div class="ap-tp-uprow">' +
      '<button type="button" class="ap-tp-btn" data-a="pick">＋ 上传照片</button>' +
      '<input type="file" accept="image/*" multiple hidden data-a="file">' +
      '<span class="ap-tp-note">上传自动压缩到长边 1280；上传完成其它设备刷新即可看到</span>' +
      '</div>' +
      '<div class="ap-tp-err" data-a="err"></div>' +
      '<div class="ap-tp-grid" data-a="grid"></div>' +
      '<div class="ap-tp-more"></div>';

    var grid = root.querySelector('[data-a="grid"]');
    var errBox = root.querySelector('[data-a="err"]');
    var moreBox = root.querySelector('.ap-tp-more');
    var fileInput = root.querySelector('[data-a="file"]');
    var offset = 0, busy = false;

    function showErr(msg) { errBox.textContent = msg || ''; }
    function setCount(n) {
      var c = root.querySelector('#ap-tp-count');
      if (c) c.textContent = n ? n + ' 张' : '';
    }

    function figHTML(href, path, own) {
      return '<figure class="ap-tp-fig">' +
        '<img src="' + esc(href) + '" loading="lazy" alt="旅拍">' +
        (own ? '<button type="button" class="ap-tp-del" data-del="' + esc(path) + '" title="删除">✕</button>' : '') +
        '</figure>';
    }

    function load() {
      if (busy) return; busy = true; showErr('');
      /* 注意：listPage() 的 list-v2 端点在平台侧返回 STORAGE_BUCKET_NOT_FOUND（实测 2026-09-29），
         用 list() + offset 分页代替；list() 的返回项在 data.objects[].name */
      client().storage.list('shared', {
        limit: PAGE, offset: offset,
        sortBy: { column: 'created_at', order: 'desc' }
      }).then(function (page) {
        var payload = (page && page.data) || page || {};
        var items = Array.isArray(payload) ? payload : (payload.items || payload.objects || []);
        var fullPage = items.length >= PAGE;   /* 满页才可能还有更多 */
        var mine = items.filter(function (it) {
          var p = (it && (it.path || it.name)) || '';
          return p.indexOf('/photos/' + guideId + '/') >= 0;
        });
        var paths = mine.map(function (it) { return it.path || it.name; });
        if (!paths.length) {
          if (!offset) grid.innerHTML = '<div class="ap-tp-empty">还没有照片，点上面「＋ 上传照片」开始记录吧</div>';
          setCount(grid.querySelectorAll('.ap-tp-fig').length);
          moreBox.innerHTML = fullPage ? '<button type="button" class="ap-tp-btn2" data-a="more">加载更多</button>' : '';
          offset += items.length;
          busy = false; return;
        }
        client().storage.createSignedUrls(paths, 3600).then(function (sr) {
          if (sr.error) { busy = false; showErr('获取图片失败：' + (sr.error.message || '')); return; }
          var raw = (sr.data != null) ? sr.data : sr;
          var arr = Array.isArray(raw) ? raw : (raw.items || raw.objects || raw.urls || raw.signedUrls || []);
          var byPath = {};
          arr.forEach(function (u) {
            if (!u) return;
            var p = u.path || u.name;
            if (p) byPath[p] = u.signedUrl || u.url || u.downloadUrl || '';
          });
          /* 批量签名缺漏的（返回结构未文档化，防御性兜底）：逐个补签名 */
          var missing = paths.filter(function (p) { return !byPath[p]; });
          var ensure = missing.length
            ? Promise.all(missing.map(function (p) {
                return client().storage.createSignedUrl(p, 3600).then(function (s) {
                  var raw2 = (s.data != null) ? s.data : s;
                  byPath[p] = (typeof raw2 === 'string') ? raw2 : (raw2.signedUrl || raw2.url || '');
                }).catch(function () {});
              }))
            : Promise.resolve();
          ensure.then(function () {
            var html = '';
            mine.forEach(function (it) {
              var p = it.path || it.name;
              var href = byPath[p];
              if (href) html += figHTML(href, p, String(p).indexOf('shared/' + uid + '/') === 0);
            });
            grid.insertAdjacentHTML('beforeend', html);
            setCount(grid.querySelectorAll('.ap-tp-fig').length);
            offset += items.length;
            moreBox.innerHTML = fullPage ? '<button type="button" class="ap-tp-btn2" data-a="more">加载更多</button>' : '';
            busy = false;
          });
        }).catch(function (e2) { busy = false; showErr('获取图片失败：' + (e2 && e2.message || '网络异常')); });
      }).catch(function (e) {
        busy = false;
        showErr('读取相册失败：' + ((e && e.message) || '网络异常'));
      });
    }
    moreBox.addEventListener('click', function (e) {
      if (e.target.closest('[data-a="more"]')) { load(); }
    });

    /* 上传 */
    root.querySelector('[data-a="pick"]').addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;
      var ok = 0, fail = 0, i = 0;
      showErr('上传中 0/' + files.length + ' …');
      (function next() {
        if (i >= files.length) {
          showErr('上传完成：成功 ' + ok + ' 张' + (fail ? '，失败 ' + fail + ' 张' : ''));
          offset = 0; grid.innerHTML = ''; load();
          return;
        }
        compress(files[i]).then(function (blob) {
          var name = 'photos/' + guideId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg';
          var path = client().storage.sharedPath(uid, name);
          return client().storage.upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        }).then(function (r) {
          if (r && r.error) { fail++; showErr('上传中 ' + i + '/' + files.length + ' …（' + (r.error.message || '失败') + '）'); }
          else ok++;
          i++;
          showErr('上传中 ' + i + '/' + files.length + ' …');
          next();
        }).catch(function (e) {
          fail++; i++;
          showErr('上传中 ' + i + '/' + files.length + ' …（' + (e && e.message || '失败') + '）');
          next();
        });
      })();
    });

    /* 删除（仅自己的文件会出现删除钮）+ 刷新 / 退出 */
    grid.addEventListener('click', function (e) {
      var del = e.target.closest && e.target.closest('[data-del]');
      if (!del) return;
      var path = del.getAttribute('data-del');
      if (!confirm('删除这张照片？不可恢复。')) return;
      client().storage.remove([path]).then(function (r) {
        if (r && r.error) { showErr('删除失败：' + (r.error.message || '')); return; }
        var f = del.closest('.ap-tp-fig'); if (f) f.remove();
        setCount(grid.querySelectorAll('.ap-tp-fig').length);
      }).catch(function () { showErr('删除失败：网络异常'); });
    });
    root.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-a]');
      if (!a) return;
      var act = a.getAttribute('data-a');
      if (act === 'refresh') { offset = 0; grid.innerHTML = ''; load(); }
      else if (act === 'signout') {
        client().auth.signOut().then(function () { refresh(root, guideId); })
          .catch(function () { showErr('退出失败，请重试'); });
      }
    });

    load();
  }

  function refresh(root, guideId) {
    var c = client();
    if (!c) return;
    c.auth.getSession().then(function (r) {
      var session = r && r.data;
      if (session && session.user) renderGallery(root, guideId, session);
      else renderLogin(root, guideId);
    }).catch(function () {
      root.innerHTML = '<div class="ap-tp-head"><span class="ap-tp-title">📷 我的旅拍</span></div>' +
        '<div class="ap-tp-note">网络异常，稍后再试。</div>';
    });
  }

  function mount(box, guideId) {
    if (!box) return;
    if (!sdkReady()) {
      box.innerHTML =
        '<div class="ap-tp-head"><span class="ap-tp-title">📷 我的旅拍</span></div>' +
        '<div class="ap-tp-note">相册模块未加载（当前离线或文件缺失），刷新页面后重试。</div>';
      return;
    }
    refresh(box, guideId);
  }

  window.WB_Photos = { mount: mount };
})();
