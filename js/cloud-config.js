/* WorkBuddy 云服务 publicConfig —— 只有这两项可安全放进前端
   （身份由服务端按发布域名 Origin 校验；敏感密钥全部留在服务端） */
window.WB_CLOUD = {
  endpoint: 'https://creams.app.workbuddy.host',
  publishableKey: 'wbpk_EQ4yZ2TzUlGCyOl6hkWxS3_s2rqUwjsJXzG4NXnJloftazO5WLRjW6A'
};
