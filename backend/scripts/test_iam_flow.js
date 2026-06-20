const BASE_URL = 'http://localhost:3000/api/v1';

async function runTest() {
  console.log('=== BẮT ĐẦU KIỂM THỬ TOÀN DIỆN CÁC API IAM MỚI ===');
  let accessToken = '';
  let superAdminId = '00000000-0000-0000-0000-000000000000';
  let testPermissionId = '';
  let newUserId = '';

  // 1. Đăng nhập Super Admin vừa được Seed tự động
  console.log('\n[1] Đăng nhập Super Admin...');
  const loginRes = await fetch(`${BASE_URL}/iam/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@solavie.vn', password: 'SuperSecurePassword@2026' })
  });
  if (!loginRes.ok) throw new Error('Login failed: ' + await loginRes.text());
  const loginData = await loginRes.json();
  accessToken = loginData.data.accessToken;
  console.log('✅ Đăng nhập thành công! Token:', accessToken.slice(0, 20) + '...');

  // 2. Lấy Profile của Super Admin (GET /iam/users/me)
  console.log('\n[2] Lấy Profile Super Admin hiện tại (GET /iam/users/me)...');
  const profileRes = await fetch(`${BASE_URL}/iam/users/me`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!profileRes.ok) throw new Error('Get profile failed: ' + await profileRes.text());
  const profileData = await profileRes.json();
  console.log('✅ Lấy Profile thành công!');
  console.log('   - ID:', profileData.data.id);
  console.log('   - Email:', profileData.data.email);
  console.log('   - Roles:', profileData.data.roles);
  console.log('   - SUPER_ADMIN Permission:', profileData.data.permissions.SUPER_ADMIN);

  // 2.5 Dọn dẹp TEST_ROLE nếu có từ lần chạy trước
  console.log('\n[2.5] Dọn dẹp TEST_ROLE cũ nếu tồn tại...');
  const cleanupRes = await fetch(`${BASE_URL}/iam/roles/TEST_ROLE`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (cleanupRes.ok || cleanupRes.status === 404 || cleanupRes.status === 204) {
    console.log('✅ Dọn dẹp TEST_ROLE hoàn tất.');
  } else {
    console.log('⚠️ Cảnh báo dọn dẹp:', await cleanupRes.text());
  }

  // 3. Lấy danh sách Permissions hệ thống (GET /iam/permissions)
  console.log('\n[3] Lấy danh sách Permissions hệ thống (GET /iam/permissions)...');
  const permRes = await fetch(`${BASE_URL}/iam/permissions`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!permRes.ok) throw new Error('Get permissions failed: ' + await permRes.text());
  const permData = await permRes.json();
  console.log('   - Debug permData:', JSON.stringify(permData));
  const permList = Array.isArray(permData.data) ? permData.data : (permData.data?.data || []);
  console.log(`✅ Lấy danh sách thành công! Tìm thấy ${permList.length} permissions.`);
  if (permList.length > 0) {
    testPermissionId = permList[0].id;
    console.log(`   - Dùng thử Permission ID [${permList[0].action}]:`, testPermissionId);
  }

  // 4. Lấy danh sách Vai trò (GET /iam/roles)
  console.log('\n[4] Lấy danh sách Roles hiện có...');
  const rolesListRes = await fetch(`${BASE_URL}/iam/roles`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!rolesListRes.ok) throw new Error('Get roles failed: ' + await rolesListRes.text());
  const rolesListData = await rolesListRes.json();
  console.log('   - Debug rolesListData:', JSON.stringify(rolesListData));
  const rolesList = Array.isArray(rolesListData.data) ? rolesListData.data : (rolesListData.data?.data || []);
  console.log('✅ Các roles mặc định có trong hệ thống:', rolesList.map(r => r.code));

  // 5. Tạo vai trò mới (POST /iam/roles)
  console.log('\n[5] Tạo vai trò mới TEST_ROLE...');
  const createRoleRes = await fetch(`${BASE_URL}/iam/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      code: 'TEST_ROLE',
      name: 'Vai trò thử nghiệm',
      description: 'Dành cho kịch bản test tự động'
    })
  });
  if (!createRoleRes.ok) throw new Error('Create role failed: ' + await createRoleRes.text());
  const createRoleData = await createRoleRes.json();
  console.log('✅ Tạo vai trò thành công! Role ID:', createRoleData.data.id);

  // 6. Sửa vai trò mới tạo (PATCH /iam/roles/TEST_ROLE)
  console.log('\n[6] Sửa thông tin vai trò TEST_ROLE...');
  const patchRoleRes = await fetch(`${BASE_URL}/iam/roles/TEST_ROLE`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: 'Vai trò thử nghiệm cập nhật',
      description: 'Mô tả cập nhật'
    })
  });
  if (!patchRoleRes.ok) throw new Error('Patch role failed: ' + await patchRoleRes.text());
  console.log('✅ Cập nhật vai trò thành công!');

  // 7. Chốt chặn bảo vệ: Thử sửa SUPER_ADMIN (Phải lỗi 400)
  console.log('\n[7] Kiểm tra chốt chặn: Thử sửa đổi vai trò SUPER_ADMIN...');
  const patchSuperRes = await fetch(`${BASE_URL}/iam/roles/SUPER_ADMIN`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ name: 'Hacker Super Admin' })
  });
  console.log('   - Status Code trả về:', patchSuperRes.status);
  if (patchSuperRes.status === 400) {
    console.log('✅ Chốt chặn hoạt động tốt! Hệ thống ngăn cản việc sửa SUPER_ADMIN.');
  } else {
    throw new Error('Thất bại: Hệ thống cho phép sửa SUPER_ADMIN hoặc trả về sai mã lỗi!');
  }

  // 8. Gán chính sách (Policy) cho TEST_ROLE (POST /iam/roles/TEST_ROLE/policies)
  console.log('\n[8] Gán Policy cho vai trò TEST_ROLE...');
  const assignPolicyRes = await fetch(`${BASE_URL}/iam/roles/TEST_ROLE/policies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      permissionId: testPermissionId,
      ruleExpression: { "==": [{ "var": "user.id" }, { "var": "resource.assigneeId" }] }
    })
  });
  if (!assignPolicyRes.ok) throw new Error('Assign policy failed: ' + await assignPolicyRes.text());
  console.log('✅ Gán Policy thành công!');

  // 9. Xem chi tiết vai trò TEST_ROLE để xác nhận policies đã có (GET /iam/roles/TEST_ROLE)
  console.log('\n[9] Xem chi tiết TEST_ROLE và policies đính kèm...');
  const detailRoleRes = await fetch(`${BASE_URL}/iam/roles/TEST_ROLE`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!detailRoleRes.ok) throw new Error('Get role detail failed: ' + await detailRoleRes.text());
  const detailRoleData = await detailRoleRes.json();
  console.log('✅ Chi tiết role:', detailRoleData.data.name);
  console.log('   - Policies count:', detailRoleData.data.policies.length);
  console.log('   - Rule Expression:', JSON.stringify(detailRoleData.data.policies[0].ruleExpression));

  // 10. Gỡ Policy khỏi TEST_ROLE (DELETE /iam/roles/TEST_ROLE/policies/:permissionId)
  console.log('\n[10] Gỡ Policy khỏi vai trò TEST_ROLE...');
  const removePolicyRes = await fetch(`${BASE_URL}/iam/roles/TEST_ROLE/policies/${testPermissionId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!removePolicyRes.ok) throw new Error('Remove policy failed: ' + await removePolicyRes.text());
  console.log('✅ Gỡ Policy thành công!');

  // 11. Xóa vai trò TEST_ROLE (DELETE /iam/roles/TEST_ROLE)
  console.log('\n[11] Xóa vai trò TEST_ROLE...');
  const deleteRoleRes = await fetch(`${BASE_URL}/iam/roles/TEST_ROLE`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (deleteRoleRes.status !== 204) throw new Error('Delete role failed: ' + await deleteRoleRes.text());
  console.log('✅ Xóa vai trò TEST_ROLE thành công!');

  // 12. Tạo User mới
  console.log('\n[12] Tạo User mới để test Reset Password...');
  const userEmail = `temp_employee_${Date.now()}@solavie.vn`;
  const createUserRes = await fetch(`${BASE_URL}/iam/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ email: userEmail, fullName: 'Employee Test Reset' })
  });
  if (!createUserRes.ok) throw new Error('Create user failed: ' + await createUserRes.text());
  const createUserData = await createUserRes.json();
  newUserId = createUserData.userId || createUserData.data?.userId;
  if (!newUserId) {
    // Dự phòng tìm ID
    const listRes = await fetch(`${BASE_URL}/iam/users`, { headers: { 'Authorization': `Bearer ${accessToken}` }});
    const listData = await listRes.json();
    const found = listData.data.data.find(u => u.email === userEmail);
    if (found) newUserId = found.id;
  }
  console.log('✅ Tạo User thành công! ID:', newUserId);

  // 13. Admin thực thi Reset Password cho User mới (POST /iam/users/:id/reset-password)
  console.log('\n[13] Kích hoạt Reset Password cho User vừa tạo...');
  const resetRes = await fetch(`${BASE_URL}/iam/users/${newUserId}/reset-password`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!resetRes.ok) throw new Error('Reset password failed: ' + await resetRes.text());
  console.log('✅ Admin reset mật khẩu cho User thành công! User đã bị deactive để bắt đầu luồng thiết lập lại.');

  console.log('\n======================================================');
  console.log('✅ TẤT CẢ CÁC BƯỚC KIỂM THỬ ĐÃ THÀNH CÔNG RỰC RỠ!');
  console.log('======================================================');
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n❌ [LỖI KIỂM THỬ]', err.message);
  process.exit(1);
});
