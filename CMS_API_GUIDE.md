# CMS API คู่มือการใช้งาน

## ภาพรวม
CMS (Content Management System) API ช่วยให้คุณจัดการข้อมูลเนื้อหาต่างๆ ในระบบได้อย่างยืดหยุ่น รองรับการทำงานกับหลาย collections เช่น banner, news, promotions เป็นต้น

## Base URL
```
/dss/cms/:collection
```

## Collections ที่รองรับ
- `banner` - แบนเนอร์โฆษณา
- `news` - ข่าวสาร
- `promotions` - โปรโมชั่น
- `categories` - หมวดหมู่
- `content` - เนื้อหาทั่วไป
- `pages` - หน้าเว็บ
- `media` - ไฟล์สื่อ
- `settings` - การตั้งค่า
- `announcements` - ประกาศ
- `events` - กิจกรรม

## Authentication
ทุก API จำเป็นต้องมี client authentication header:
```
Headers:
  client-token-key: YOUR_CLIENT_TOKEN
```

## API Endpoints

### 1. ดึงรายการข้อมูล (GET)
```
GET /dss/cms/{collection}
```

#### Parameters
- `clusterId` - ID ของ cluster สำหรับกรองข้อมูล (สำคัญ!)
- `sort` - เรียงลำดับ (field หรือ -field สำหรับ DESC)
- `paging` - เปิด/ปิด pagination (true/false)
- `page` - หน้าที่ต้องการ (เริ่มจาก 1)
- `limit` - จำนวนรายการต่อหน้า
- ฟิลด์อื่นๆ - ใช้สำหรับการค้นหา/กรอง

#### ตัวอย่าง
```bash
# ดึงข้อมูลทั้งหมดจาก cluster ระบุ
GET /dss/cms/news?key=DU1eYMDG7j8yb199YDPg3&clusterId=6801d7765d22052ed2bdf10b

# ดึงข้อมูลแบบ pagination จาก cluster
GET /dss/cms/banner?paging=true&page=1&limit=10&clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3

# เรียงลำดับตามวันที่สร้าง (ใหม่ไปเก่า)
GET /dss/cms/banner?sort=-createdAt&clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3

# ค้นหาตามชื่อในคลัสเตอร์ระบุ
GET /dss/cms/banner?title=โปรโมชั่น&clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3

# รวมหลายเงื่อนไข
GET /dss/cms/banner?active=true&sort=-createdAt&paging=true&page=1&limit=5&clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3
```

#### Response
```json
{
  "success": true,
  "data": [
    {
      "_id": "67123abc456def789012345",
      "title": "โปรโมชั่นพิเศษ",
      "image": "banner1.jpg",
      "active": true,
      "createdAt": "2025-10-26T10:30:00Z",
      "updatedAt": "2025-10-26T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "pages": 3
  }
}
```

### 2. ดึงข้อมูลเดียว (GET by ID)
```
GET /dss/cms/{collection}/{id}?clusterId={clusterId}
```

#### ตัวอย่าง
```bash
GET /dss/cms/banner/67123abc456def789012345?clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3
```

#### Response
```json
{
  "success": true,
  "data": {
    "_id": "67123abc456def789012345",
    "title": "โปรโมชั่นพิเศษ",
    "image": "banner1.jpg",
    "active": true,
    "createdAt": "2025-10-26T10:30:00Z",
    "updatedAt": "2025-10-26T10:30:00Z"
  }
}
```

### 3. สร้างข้อมูลใหม่ (POST)
```
POST /dss/cms/{collection}?clusterId={clusterId}
```

#### ตัวอย่าง
```bash
POST /dss/cms/banner?clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3
Content-Type: application/json

{
  "title": "โปรโมชั่นลดราคา 50%",
  "image": "promo-banner.jpg",
  "description": "โปรโมชั่นพิเศษลดราคาสินค้าทุกชิ้น",
  "active": true,
  "startDate": "2025-11-01",
  "endDate": "2025-11-30"
}
```

**หมายเหตุ:** `clusterId` จะถูกเพิ่มเข้าไปใน document อัตโนมัติ

#### Response
```json
{
  "success": true,
  "data": {
    "id": "67123abc456def789012346",
    "title": "โปรโมชั่นลดราคา 50%",
    "image": "promo-banner.jpg",
    "description": "โปรโมชั่นพิเศษลดราคาสินค้าทุกชิ้น",
    "active": true,
    "startDate": "2025-11-01",
    "endDate": "2025-11-30",
    "createdAt": "2025-10-26T11:00:00Z",
    "updatedAt": "2025-10-26T11:00:00Z"
  }
}
```

### 4. อัปเดตข้อมูล (PUT)
```
PUT /dss/cms/{collection}/{id}?clusterId={clusterId}
```

#### ตัวอย่าง
```bash
PUT /dss/cms/banner/67123abc456def789012345?clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3
Content-Type: application/json

{
  "active": false,
  "description": "โปรโมชั่นหมดอายุแล้ว"
}
```

#### Response
```json
{
  "success": true,
  "data": {
    "_id": "67123abc456def789012345",
    "title": "โปรโมชั่นพิเศษ",
    "image": "banner1.jpg",
    "active": false,
    "description": "โปรโมชั่นหมดอายุแล้ว",
    "createdAt": "2025-10-26T10:30:00Z",
    "updatedAt": "2025-10-26T12:00:00Z"
  }
}
```

### 5. ลบข้อมูล (DELETE)
```
DELETE /dss/cms/{collection}/{id}?clusterId={clusterId}
```

#### ตัวอย่าง
```bash
DELETE /dss/cms/banner/67123abc456def789012345?clusterId=6801d7765d22052ed2bdf10b&key=DU1eYMDG7j8yb199YDPg3
```

#### Response
```json
{
  "success": true,
  "message": "banner item deleted successfully",
  "id": "67123abc456def789012345"
}
```

## ตัวอย่างการใช้งานจริง

### จัดการแบนเนอร์
```bash
# 1. สร้างแบนเนอร์ใหม่
POST /dss/cms/banner
{
  "title": "แบนเนอร์หน้าแรก",
  "image": "homepage-banner.jpg",
  "link": "/promotion-page",
  "active": true,
  "position": 1
}

# 2. ดึงแบนเนอร์ที่ active
GET /dss/cms/banner?active=true&sort=position

# 3. อัปเดตลำดับแบนเนอร์
PUT /dss/cms/banner/67123abc456def789012345
{
  "position": 2
}

# 4. ปิดการใช้งานแบนเนอร์
PUT /dss/cms/banner/67123abc456def789012345
{
  "active": false
}
```

### จัดการข่าวสาร
```bash
# 1. สร้างข่าวใหม่
POST /dss/cms/news
{
  "title": "ข่าวสารล่าสุด",
  "content": "เนื้อหาข่าวสาร...",
  "author": "Admin",
  "category": "general",
  "featured": true,
  "publishDate": "2025-10-26"
}

# 2. ดึงข่าวที่โดดเด่น
GET /dss/cms/news?featured=true&sort=-publishDate

# 3. ค้นหาข่าวตามหมวดหมู่
GET /dss/cms/news?category=general&paging=true&limit=5
```

### จัดการโปรโมชั่น
```bash
# 1. สร้างโปรโมชั่น
POST /dss/cms/promotions
{
  "name": "ลดราคา Black Friday",
  "description": "ลดราคาสินค้าทุกชิ้น 70%",
  "discount": 70,
  "startDate": "2025-11-29",
  "endDate": "2025-12-01",
  "active": true
}

# 2. ดึงโปรโมชั่นที่ใช้งานได้
GET /dss/cms/promotions?active=true
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid ID format"
}
```

### 400 Invalid Collection
```json
{
  "error": "Invalid collection name: invalid_collection",
  "allowedCollections": ["banner", "news", "promotions", "categories", "content", "pages", "media", "settings", "announcements", "events"]
}
```

### 404 Not Found
```json
{
  "error": "banner item not found",
  "id": "67123abc456def789012345"
}
```

### 500 Internal Server Error
```json
{
  "error": "Database connection failed",
  "collection": "banner"
}
```

## Tips การใช้งาน

### 1. Pagination
- ใช้ `paging=true` เมื่อข้อมูลเยอะ
- `limit` ไม่ควรเกิน 100 รายการต่อครั้ง
- `page` เริ่มนับจาก 1

### 2. Sorting
- ใช้ `-` หน้าชื่อฟิลด์สำหรับเรียงแบบ DESC
- เช่น `sort=-createdAt` (ใหม่ไปเก่า)
- เช่น `sort=title` (A-Z)

### 3. Search/Filter
- ใช้ชื่อฟิลด์เป็น parameter
- รองรับ text search ด้วย regex (case-insensitive)
- เช่น `title=โปรโมชั่น` จะหาทุกรายการที่มีคำว่า "โปรโมชั่น"

### 4. Timestamps
- ระบบจะเพิ่ม `createdAt` อัตโนมัติเมื่อสร้าง
- ระบบจะอัปเดต `updatedAt` อัตโนมัติเมื่อแก้ไข
- รูปแบบ: ISO 8601 (2025-10-26T10:30:00Z)

### 5. Best Practices
- ใช้ ID ที่ถูกต้อง (24 characters hex)
- ตรวจสอบ response status code
- Handle errors อย่างเหมาะสม
- ใช้ pagination สำหรับข้อมูลจำนวนมาก

## ตัวอย่าง JavaScript

```javascript
// ฟังก์ชันสำหรับเรียก API
async function cmsAPI(method, collection, id = '', data = null, params = {}) {
  const baseUrl = '/dss/cms';
  let url = `${baseUrl}/${collection}`;
  if (id) url += `/${id}`;
  
  // เพิ่ม query parameters
  if (Object.keys(params).length > 0) {
    const queryString = new URLSearchParams(params).toString();
    url += `?${queryString}`;
  }
  
  const config = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'client-token-key': 'YOUR_CLIENT_TOKEN'
    }
  };
  
  if (data) {
    config.body = JSON.stringify(data);
  }
  
  const response = await fetch(url, config);
  return await response.json();
}

// ตัวอย่างการใช้งาน
async function examples() {
  // ดึงแบนเนอร์ทั้งหมด
  const banners = await cmsAPI('GET', 'banner');
  
  // ดึงแบนเนอร์แบบ pagination
  const paginatedBanners = await cmsAPI('GET', 'banner', '', null, {
    paging: 'true',
    page: 1,
    limit: 10,
    sort: '-createdAt'
  });
  
  // สร้างแบนเนอร์ใหม่
  const newBanner = await cmsAPI('POST', 'banner', '', {
    title: 'แบนเนอร์ใหม่',
    image: 'new-banner.jpg',
    active: true
  });
  
  // อัปเดตแบนเนอร์
  const updatedBanner = await cmsAPI('PUT', 'banner', '67123abc456def789012345', {
    active: false
  });
  
  // ลบแบนเนอร์
  const deletedBanner = await cmsAPI('DELETE', 'banner', '67123abc456def789012345');
}
```

---

**หมายเหตุ:** API นี้ใช้ MongoDB เป็น database และต้องมี client authentication ที่ถูกต้องเสมอ