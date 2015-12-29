// Check localStorage for the basic auth credentials
(function() {
  // Create a dynamic style to hide the body and any basic auth errors.
  document.write('<style>body { display:none; } [data-basic-auth-error] {display: none; }</style>');

  var authHeader = sessionStorage.getItem('basicAuthHeader');
  if (authHeader) {
    // console.log('login with stored creds', authHeader);
    login(authHeader);
  } else {
    // Show login form.
    document.body.style.display = 'block';
    var authForm = document.querySelector('[data-basic-auth-form]');
    authForm.addEventListener('submit', function() {
      authHeader = 'Basic ' + btoa(document.getElementById('username').value + ':' + document.getElementById('password').value);
      login(authHeader);
    });
  }

  function login() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', location.pathname, true);
    xhr.setRequestHeader('Authorization', authHeader);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 0 || xhr.readyState === 4) {
        if (xhr.status === 200) {
          // Store the credentials in localStorage
          sessionStorage.setItem('basicAuthHeader', authHeader);

          // Replace the entire document with the result.
          document.open();
          document.write(xhr.responseText);
          document.close();
        } else if (xhr.status === 401) {
          document.body.style.display = 'block';

          // If there is a data-basic-auth-error element, show it.
          var authError = document.querySelector('data-basic-auth-error');
          authError.style.display = 'block';
        } else {
          // For all other status codes replace the page with the custom error page in the response.
          document.open();
          document.write(xhr.responseText);
          document.close();
        }
      }
    };
    xhr.send(null);
  }
})();
