const BASE_URL = 'http://localhost:3000/api/v1';

async function runTest() {
  console.log('=== BẮT ĐẦU KIỂM THỬ TẠO ROLE ĐÍNH KÈM PERMISSIONS ===');
  
  // 1. Đăng nhập
  const loginRes = await fetch(`${BASE_URL}/iam/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@solavie.vn', password: 'SuperSecurePassword@2026' })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const loginData = await loginRes.json();
  const token = loginData.data.accessToken;
  const headers = { 
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  const deleteHeaders = { 
    'Authorization': `Bearer ${token}`
  };

  // 2. Dọn dẹp vai trò cũ (nếu có)
  const delRes = await fetch(`${BASE_URL}/iam/roles/API_TEST_ROLE`, {
    method: 'DELETE',
    headers: deleteHeaders
  });
  console.log(`   - Cleanup old role status: ${delRes.status}`);
  if (!delRes.ok && delRes.status !== 404) {
    console.log(`   - Cleanup response error: ${await delRes.text()}`);
  }

  // 3. Lấy danh sách permissions để có ID
  const permRes = await fetch(`${BASE_URL}/iam/permissions?limit=2`, { headers });
  const permData = await permRes.json();
  const permIds = permData.data.map(p => p.id);
  console.log('   - Sử dụng các Permission IDs sau để gán:', permIds);

  // 4. Tạo Role mới đi kèm permissions
  console.log('\n[1] Gửi request tạo API_TEST_ROLE kèm permissions...');
  const createRes = await fetch(`${BASE_URL}/iam/roles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      code: 'API_TEST_ROLE',
      name: 'Vai trò thử nghiệm API đính kèm',
      description: 'Mô tả vai trò',
      permissionIds: permIds
    })
  });
  if (!createRes.ok) throw new Error('Create role with perms failed: ' + await createRes.text());
  const createData = await createRes.json();
  console.log('✅ Tạo vai trò thành công!');

  // 5. Kiểm tra chi tiết vai trò xem đã có policies được gán chưa
  console.log('\n[2] Kiểm tra chi tiết API_TEST_ROLE để xác thực mappings...');
  const detailRes = await fetch(`${BASE_URL}/iam/roles/API_TEST_ROLE`, { headers });
  const detailData = await detailRes.json();
  console.log('   - Policies count:', detailData.data.policies.length);
  if (detailData.data.policies.length !== permIds.length) {
    throw new Error(`Expected ${permIds.length} policies, but got ${detailData.data.policies.length}`);
  }
  console.log('✅ Ánh xạ permissions đã được tạo thành công ngay lúc sinh Role!');

  // 6. Dọn dẹp
  console.log('\n[3] Xóa vai trò API_TEST_ROLE...');
  const endDelRes = await fetch(`${BASE_URL}/iam/roles/API_TEST_ROLE`, {
    method: 'DELETE',
    headers: deleteHeaders
  });
  console.log(`   - End cleanup status: ${endDelRes.status}`);
  console.log('✅ Dọn dẹp hoàn tất.');

  console.log('\n======================================================');
  console.log('✅ BÀI KIỂM THỬ ĐÃ THÀNH CÔNG RỰC RỠ!');
  console.log('======================================================');
}

runTest().catch(err => {
  console.error('\n❌ [LỖI KIỂM THỬ]', err.message);
  process.exit(1);
});
