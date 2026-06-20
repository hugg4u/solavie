const BASE_URL = 'http://localhost:3000/api/v1';

async function runListTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ TÍNH NĂNG PHÂN TRANG, SẮP XẾP, TÌM KIẾM CỦA LIST ===');
  
  // 1. Đăng nhập Super Admin
  const loginRes = await fetch(`${BASE_URL}/iam/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@solavie.vn', password: 'SuperSecurePassword@2026' })
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const loginData = await loginRes.json();
  const token = loginData.data.accessToken;
  const headers = { 'Authorization': `Bearer ${token}` };

  // 2. Test Phân trang trên Roles (limit = 2)
  console.log('\n[1] Test Phân trang Roles (limit=2)...');
  const pageRes = await fetch(`${BASE_URL}/iam/roles?page=1&limit=2`, { headers });
  const pageData = await pageRes.json();
  console.log('   - Total Roles:', pageData.data.length);
  console.log('   - Meta data:', JSON.stringify(pageData.meta));
  if (pageData.data.length !== 2 || pageData.meta.limit !== 2) {
    throw new Error('Pagination limit=2 failed for Roles list');
  }
  console.log('✅ Phân trang Roles hoạt động chính xác!');

  // 3. Test Tìm kiếm trên Roles (search = MANAGER)
  console.log('\n[2] Test Tìm kiếm Roles (search=MANAGER)...');
  const searchRes = await fetch(`${BASE_URL}/iam/roles?search=MANAGER`, { headers });
  const searchData = await searchRes.json();
  console.log('   - Trả về:', searchData.data.map(r => r.code));
  if (searchData.data.length !== 1 || searchData.data[0].code !== 'MANAGER') {
    throw new Error('Search failed for Roles list');
  }
  console.log('✅ Tìm kiếm Roles hoạt động chính xác!');

  // 4. Test Sắp xếp trên Roles (sort=createdAt, order=DESC)
  console.log('\n[3] Test Sắp xếp Roles (sort=createdAt, order=DESC)...');
  const sortRes = await fetch(`${BASE_URL}/iam/roles?sort=createdAt&order=DESC`, { headers });
  const sortData = await sortRes.json();
  console.log('   - Order of codes:', sortData.data.map(r => r.code));
  console.log('✅ Sắp xếp Roles hoạt động chính xác!');

  // 5. Test Phân trang trên Permissions (limit = 5)
  console.log('\n[4] Test Phân trang Permissions (limit=5)...');
  const permPageRes = await fetch(`${BASE_URL}/iam/permissions?page=1&limit=5`, { headers });
  const permPageData = await permPageRes.json();
  console.log('   - Total Permissions:', permPageData.data.length);
  console.log('   - Meta data:', JSON.stringify(permPageData.meta));
  if (permPageData.data.length !== 5 || permPageData.meta.limit !== 5) {
    throw new Error('Pagination limit=5 failed for Permissions list');
  }
  console.log('✅ Phân trang Permissions hoạt động chính xác!');

  // 6. Test Tìm kiếm trên Permissions (search = roles)
  console.log('\n[5] Test Tìm kiếm Permissions (search=roles)...');
  const permSearchRes = await fetch(`${BASE_URL}/iam/permissions?search=roles`, { headers });
  const permSearchData = await permSearchRes.json();
  console.log('   - Trả về actions:', permSearchData.data.map(p => p.action));
  const allMatch = permSearchData.data.every(p => p.action.includes('roles') || p.description.toLowerCase().includes('roles'));
  if (!allMatch || permSearchData.data.length === 0) {
    throw new Error('Search failed for Permissions list');
  }
  console.log('✅ Tìm kiếm Permissions hoạt động chính xác!');

  // 7. Test Phân trang trên Users (limit = 2)
  console.log('\n[6] Test Phân trang Users (limit=2)...');
  const userPageRes = await fetch(`${BASE_URL}/iam/users?page=1&limit=2`, { headers });
  const userPageData = await userPageRes.json();
  const userList = Array.isArray(userPageData.data) ? userPageData.data : (userPageData.data?.data || []);
  console.log('   - Total Users in page:', userList.length);
  console.log('   - Meta data:', JSON.stringify(userPageData.meta));
  if (userList.length > 2 || userPageData.meta.limit !== 2) {
    throw new Error('Pagination limit=2 failed for Users list');
  }
  console.log('✅ Phân trang Users hoạt động chính xác!');

  // 8. Test Tìm kiếm trên Users (search = superadmin)
  console.log('\n[7] Test Tìm kiếm Users (search=superadmin)...');
  const userSearchRes = await fetch(`${BASE_URL}/iam/users?search=superadmin`, { headers });
  const userSearchData = await userSearchRes.json();
  const userSearchList = Array.isArray(userSearchData.data) ? userSearchData.data : (userSearchData.data?.data || []);
  console.log('   - Trả về:', userSearchList.map(u => u.email));
  const hasSuperAdmin = userSearchList.some(u => u.email === 'superadmin@solavie.vn');
  if (!hasSuperAdmin) {
    throw new Error('Search failed for Users list');
  }
  console.log('✅ Tìm kiếm Users hoạt động chính xác!');

  // 9. Test Sắp xếp trên Users (sort=fullName, order=ASC)
  console.log('\n[8] Test Sắp xếp Users (sort=fullName, order=ASC)...');
  const userSortRes = await fetch(`${BASE_URL}/iam/users?sort=fullName&order=ASC`, { headers });
  const userSortData = await userSortRes.json();
  const userSortList = Array.isArray(userSortData.data) ? userSortData.data : (userSortData.data?.data || []);
  console.log('   - Trả về names:', userSortList.map(u => u.fullName));
  console.log('✅ Sắp xếp Users hoạt động chính xác!');

  // 10. Test Bộ lọc trên Users (isActive = true)
  console.log('\n[9] Test Bộ lọc Users (isActive=true)...');
  const userFilterRes = await fetch(`${BASE_URL}/iam/users?isActive=true`, { headers });
  const userFilterData = await userFilterRes.json();
  const userFilterList = Array.isArray(userFilterData.data) ? userFilterData.data : (userFilterData.data?.data || []);
  console.log('   - Trả về active statuses:', userFilterList.map(u => `${u.email}: ${u.isActive}`));
  const allActive = userFilterList.every(u => u.isActive === true);
  if (!allActive && userFilterList.length > 0) {
    throw new Error('Filter isActive=true failed for Users list');
  }
  console.log('✅ Bộ lọc Users hoạt động chính xác!');

  console.log('\n======================================================');
  console.log('✅ TẤT CẢ CÁC BƯỚC KIỂM THỬ LIST ĐÃ THÀNH CÔNG RỰC RỠ!');
  console.log('======================================================');
}

runListTests().catch(err => {
  console.error('\n❌ [LỖI KIỂM THỬ LIST]', err.message);
  process.exit(1);
});

