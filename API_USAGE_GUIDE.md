# API Usage Guide - SIE, SCM, APPTECH Endpoints

## Overview
API endpoints สำหรับจัดการข้อมูล SIE, SCM, และ APPTECH ที่มี clusterId กำกับอยู่ โดยรองรับการเพิ่มข้อมูลแบบยืดหยุ่น (flexible data structure)

## Base URL
```
/clusters/:clusterId/
```

## Collections
- `sie` - เก็บข้อมูล SIE
- `scm` - เก็บข้อมูล SCM  
- `apptech` - เก็บข้อมูล APPTECH

---

## SIE Endpoints

### 1. ดึงข้อมูล SIE ทั้งหมดของ cluster
```http
GET /clusters/{clusterId}/sie
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "64f5a1b2c3d4e5f6a7b8c9d0",
      "clusterId": "cluster123",
      "name": "SIE System 1",
      "version": "1.0.0",
      "status": "active",
      "createdAt": "2023-09-04T10:30:00.000Z",
      "updatedAt": "2023-09-04T10:30:00.000Z"
    }
  ]
}
```

### 2. เพิ่มข้อมูล SIE ใหม่
```http
POST /clusters/{clusterId}/sie
Content-Type: application/json
```

**Request Body (ยืดหยุ่น - สามารถส่งคีย์อะไรก็ได้):**
```json
{
  "name": "SIE System 2",
  "version": "2.0.0",
  "status": "active",
  "config": {
    "host": "192.168.1.100",
    "port": 8080
  },
  "customField": "any value",
  "anotherField": {
    "nested": "data"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "64f5a1b2c3d4e5f6a7b8c9d1",
    "name": "SIE System 2",
    "version": "2.0.0",
    "status": "active",
    "config": {
      "host": "192.168.1.100",
      "port": 8080
    },
    "customField": "any value",
    "anotherField": {
      "nested": "data"
    },
    "clusterId": "cluster123",
    "createdAt": "2023-09-04T11:00:00.000Z",
    "updatedAt": "2023-09-04T11:00:00.000Z"
  }
}
```

### 3. ดึงข้อมูล SIE เฉพาะรายการ
```http
GET /clusters/{clusterId}/sie/{id}
```

### 4. อัปเดตข้อมูล SIE
```http
PUT /clusters/{clusterId}/sie/{id}
Content-Type: application/json
```

**Request Body:**
```json
{
  "status": "inactive",
  "version": "2.1.0",
  "newField": "updated value"
}
```

### 5. ลบข้อมูล SIE
```http
DELETE /clusters/{clusterId}/sie/{id}
```

---

## SCM Endpoints

### 1. ดึงข้อมูล SCM ทั้งหมดของ cluster
```http
GET /clusters/{clusterId}/scm
```

### 2. เพิ่มข้อมูล SCM ใหม่
```http
POST /clusters/{clusterId}/scm
Content-Type: application/json
```

**Request Body Example:**
```json
{
  "name": "SCM System 1",
  "type": "git",
  "repository": "https://github.com/example/repo.git",
  "branch": "main",
  "credentials": {
    "username": "user123",
    "token": "ghp_xxxxxxxxxxxx"
  },
  "webhooks": [
    {
      "event": "push",
      "url": "https://api.example.com/webhook"
    }
  ]
}
```

### 3. ดึงข้อมูล SCM เฉพาะรายการ
```http
GET /clusters/{clusterId}/scm/{id}
```

### 4. อัปเดตข้อมูล SCM
```http
PUT /clusters/{clusterId}/scm/{id}
```

### 5. ลบข้อมูล SCM
```http
DELETE /clusters/{clusterId}/scm/{id}
```

---

## APPTECH Endpoints

### 1. ดึงข้อมูล APPTECH ทั้งหมดของ cluster
```http
GET /clusters/{clusterId}/apptech
```

### 2. เพิ่มข้อมูล APPTECH ใหม่
```http
POST /clusters/{clusterId}/apptech
Content-Type: application/json
```

**Request Body Example:**
```json
{
  "name": "Application Tech 1",
  "technology": "Node.js",
  "framework": "Express.js",
  "database": "MongoDB",
  "deployment": {
    "type": "docker",
    "image": "node:18-alpine",
    "ports": [3000, 8080]
  },
  "environment": {
    "NODE_ENV": "production",
    "DB_HOST": "mongodb://localhost:27017"
  },
  "monitoring": {
    "enabled": true,
    "tools": ["prometheus", "grafana"]
  }
}
```

### 3. ดึงข้อมูล APPTECH เฉพาะรายการ
```http
GET /clusters/{clusterId}/apptech/{id}
```

### 4. อัปเดตข้อมูล APPTECH
```http
PUT /clusters/{clusterId}/apptech/{id}
```

### 5. ลบข้อมูล APPTECH
```http
DELETE /clusters/{clusterId}/apptech/{id}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid ID format"
}
```

### 404 Not Found
```json
{
  "error": "SIE data not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to fetch SIE data"
}
```

---

## Key Features

### 1. Flexible Data Structure
- สามารถส่งข้อมูลคีย์อะไรก็ได้ใน request body
- ระบบจะเก็บข้อมูลทั้งหมดที่ส่งมา
- ไม่จำกัดโครงสร้างข้อมูล

### 2. Automatic Fields
- `clusterId`: เพิ่มอัตโนมัติจาก URL parameter
- `createdAt`: เพิ่มอัตโนมัติเมื่อสร้างข้อมูลใหม่
- `updatedAt`: อัปเดตอัตโนมัติเมื่อแก้ไขข้อมูล

### 3. Security
- ตรวจสอบ ObjectId format
- ตรวจสอบ clusterId ในทุก operation
- ป้องกันการแก้ไข `_id` field

---

## Example Usage with cURL

### เพิ่มข้อมูล SIE
```bash
curl -X POST http://localhost:3000/clusters/cluster123/sie \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SIE Production",
    "version": "3.0.0",
    "config": {
      "host": "prod.example.com",
      "ssl": true
    }
  }'
```

### ดึงข้อมูล SCM ทั้งหมด
```bash
curl http://localhost:3000/clusters/cluster123/scm
```

### อัปเดตข้อมูล APPTECH
```bash
curl -X PUT http://localhost:3000/clusters/cluster123/apptech/64f5a1b2c3d4e5f6a7b8c9d0 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "updated",
    "version": "4.0.0"
  }'
```

---

## Notes for AI Training

1. **Flexible Schema**: ระบบรองรับการเพิ่มข้อมูลแบบยืดหยุ่น ไม่จำกัดโครงสร้าง
2. **Cluster Scoped**: ข้อมูลทั้งหมดถูกจัดกลุ่มตาม clusterId
3. **RESTful Design**: ใช้ HTTP methods ตามมาตรฐาน REST API
4. **Error Handling**: มี error response ที่ชัดเจน
5. **Timestamp Tracking**: ติดตามเวลาสร้างและแก้ไขอัตโนมัติ 