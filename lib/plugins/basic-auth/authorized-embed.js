/* eslint wrap-iife: 0 */
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    // Attach event listener to any logout links
    var logoutElem = document.querySelector('[data-basic-auth-logout]');
    if (!logoutElem) return;

    logoutElem.addEventListener('click', function(event) {
      var destUrl = event.target.getAttribute('href');

      switch (window.__4front__.basicAuthType) {
        case 'standard':
          standardAuthLogout(destUrl);
          break;
        case 'custom':
          customAuthLogout(destUrl);
          break;
        default:
          break;
      }
      event.preventDefault();
    });
  });

  function customAuthLogout(destUrl) {
    var sessionKey = window.__4front__.authSessionTokenKey;

    // Clear out the auth token from browser session
    // storage and reload the window.
    sessionStorage.removeItem(sessionKey);
    location.assign(destUrl);
  }

  function standardAuthLogout(destUrl) {
    // Make an XHR call with intentionally wrong credentials
    var xhr = new XMLHttpRequest();
    xhr.open('GET', location.pathname, false);
    xhr.setRequestHeader('Accept', 'text/html');
    xhr.setRequestHeader('Authorization', 'Basic ' + btoa('__invalid__:__invalid'));
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 0 || xhr.readyState === 4) {
        location.assign(destUrl);
      }
    };

    xhr.send();
  }
})();
