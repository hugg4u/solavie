async function testLogin() {
  console.log('Testing IAM Login...');
  try {
    const res = await fetch('http://localhost:3000/api/v1/iam/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@solavie.vn', password: 'Admin@123' })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', data);
    
    // Test refresh token request (Since it requires cookies, we need to extract Set-Cookie from headers)
    const setCookieHeader = res.headers.get('set-cookie');
    
    if (res.ok) {
      console.log('✅ Login test passed!');
      if (setCookieHeader) {
          console.log('✅ Found Set-Cookie header for refresh token!');
      } else {
          console.log('⚠️ No Set-Cookie header found.');
      }
    } else {
      console.error('❌ Login test failed!');
    }
  } catch (err) {
    console.error('Connection error:', err.message);
  }
}

testLogin();
