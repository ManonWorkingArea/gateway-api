# Dynamic API App

This API allows you to perform basic CRUD operations on a MongoDB database, with support for sub-document arrays.

## Endpoints

### Create a new document in a collection

URL: /api/:collection
Method: POST
Body (single unique field check):
{
  "data": {
    "field1": "value1",
    "field2": "value2"
  },
  "options": {
    "unique": "field1"
  }
}

Body (multiple unique field checks):
{
  "data": {
    "field1": "value1",
    "field2": "value2"
  },
  "options": {
    "unique": ["field1", "field2"]
  }
}

Body (multiple unique field checks & set type):
{
  "data": {
    "name": "Titaphon Sanoi",
    "email": "info@titaphon.com"
  },
  "options": {
    "fieldType": [
      ["name", "objectId"],
      ["name", "objectId"]
    ],
    "uniqueFields": ["course", "user"]
  }
}

### Read documents from a collection

Get all documents:

URL: /api/:collection
Method: GET

Get a single document:

URL: /api/:collection/:documentId
Method: GET

Get a single document with a join on a subarray:

URL: /api/:collection/:documentId?join=joinCollection&sub=subArray
Method: GET

### Update a document in a collection

URL: /api/:collection/:documentId
Method: PUT
Body:
{
  "field1": "new_value1",
  "field2": "new_value2"
}

### Delete a document in a collection

URL: /api/:collection/:documentId
Method: DELETE

### Perform sub-document array operations (add, update, remove)

URL: /api/:collection/:documentId/:arrayField
Method: POST
Body:
{
  "action": "add" | "update" | "remove",
  "element": "element_value",
  "type": "objectId",
  "newElement": "new_element_value" (optional, required for update)
}

### Query documents from a collection

URL: /api/:collection/query
Method: POST
Body:
{
  "method": "find",
  "args": [{ "field1": "value1" }]
}

### ตัวอย่างการค้นหาเอกสารในคอลเลกชัน:

1. ค้นหาเอกสารที่มีค่าเฉพาะสำหรับฟิลด์:

{
  "method": "find",
  "args": [{ "field1": "value1" }]
}

2. ค้นหาเอกสารที่ค่าของฟิลด์มากกว่าค่าที่ระบุ:

{
  "method": "find",
  "args": [{ "field1": { "$gt": 10 } }]
}

3. ค้นหาเอกสารที่ค่าของฟิลด์อยู่ในช่วงที่ระบุ:

{
  "method": "find",
  "args": [{ "field1": { "$gte": 10, "$lte": 20 } }]
}

4. ค้นหาเอกสารที่ค่าของฟิลด์ตรงกับนิพจน์ปกติ (ตัวพิมพ์ใหญ่-เล็ก):

{
  "method": "find",
  "args": [{ "field1": { "$regex": "pattern" } }]
}

6. ค้นหาเอกสารที่อาร์เรย์ย่อยมีค่าอย่างน้อยหนึ่งค่าจากรายการค่า:

{
  "method": "find",
  "args": [
    {
      "tags": {
        "$in": ["tag1"]
      }
    }
  ]
}

7. ค้นหาเอกสารที่อาร์เรย์ย่อยมีค่าทั้งหมดจากรายการค่า:

{
  "method": "find",
  "args": [
    {
      "tags": {
        "$all": ["tag1", "tag2", "tag3"]
      }
    }
  ]
}

8. ค้นหาเอกสารที่อาร์เรย์ย่อยมีความยาวเฉพาะ:

{
  "method": "find",
  "args": [{ "subArray": { "$size": 3 } }]
}

9. Join data with multi collection *ต้องบันทึกข้อมูลเป็น objectId เท่านั้น
{
  "method": "aggregate",
  "args": [
    [
      {
        "$lookup": {
          "from": "user",
          "localField": "user",
          "foreignField": "_id",
          "as": "user"
        }
      },
      {
        "$lookup": {
          "from": "course",
          "localField": "course",
          "foreignField": "_id",
          "as": "course"
        }
      }
    ]
  ]
}

ค้นหาและ join data แบบ Advance
{
  "method": "aggregate",
  "args": [
    [
      {
        "$lookup": {
          "from": "user",
          "localField": "user",
          "foreignField": "_id",
          "as": "user"
        }
      },
      {
        "$lookup": {
          "from": "course",
          "localField": "course",
          "foreignField": "_id",
          "as": "course"
        }
      },
      {
        "$lookup": {
          "from": "player",
          "localField": "course._id",
          "foreignField": "course",
          "as": "course.players"
        }
      },
      {
        "$addFields": {
          "course.players": {
            "$map": {
              "input": "$course.players",
              "as": "player",
              "in": {
                "_id": "$$player._id",
                "name": "$$player.name",
                "course": "$$player.course"
              }
            }
          }
        }
      }
    ]
  ]
}

ค้นหาและ join data แบบ Advance 2 : Show All Data

{
  "method": "aggregate",
  "args": [
    [
      {
        "$lookup": {
          "from": "user",
          "localField": "user",
          "foreignField": "_id",
          "as": "user"
        }
      },
      {
        "$lookup": {
          "from": "course",
          "localField": "course",
          "foreignField": "_id",
          "as": "course"
        }
      },
      {
        "$unwind": "$course"
      },
      {
        "$lookup": {
          "from": "player",
          "let": { "courseId": "$course._id" },
          "pipeline": [
            {
              "$match": {
                "$expr": {
                  "$eq": ["$course", "$$courseId"]
                }
              }
            },
            {
              "$project": {
                "_id": 1,
                "name": 1,
                "course": 1
              }
            }
          ],
          "as": "players"
        }
      },
      {
        "$project": {
          "_id": 1,
          "user": 1,
          "course": 1,
          "players": 1
        }
      }
    ]
  ]
}

ค้นหาและ join data แบบ Advance 2 : Show ข้อมูลแบบเจาะจง

{
  "method": "aggregate",
  "args": [
    [
       {
        "$match": {
          "$expr": {
            "$eq": ["$user", { "$toObjectId": "64111dd005ea3a0ca301af11" }]
          }
        }
      },
      {
        "$lookup": {
          "from": "user",
          "localField": "user",
          "foreignField": "_id",
          "as": "user"
        }
      },
      {
        "$lookup": {
          "from": "course",
          "localField": "course",
          "foreignField": "_id",
          "as": "course"
        }
      },
      {
        "$unwind": "$course"
      },
      {
        "$lookup": {
          "from": "player",
          "let": { "courseId": "$course._id" },
          "pipeline": [
            {
              "$match": {
                "$expr": {
                  "$eq": ["$course", "$$courseId"]
                }
              }
            },
            {
              "$project": {
                "_id": 1,
                "name": 1,
                "course": 1
              }
            }
          ],
          "as": "players"
        }
      },
      {
        "$project": {
          "_id": 1,
          "user": 1,
          "course": 1,
          "players": 1
        }
      }
    ]
  ]
}


{
  "method": "aggregate",
  "args": [
    [
      {
        "$match": {
          "$expr": {
            "$eq": ["$user", { "$toObjectId": "64111dd005ea3a0ca301af11" }]
          }
        }
      },
      {
        "$lookup": {
          "from": "user",
          "localField": "user",
          "foreignField": "_id",
          "as": "user"
        }
      },
      {
        "$lookup": {
          "from": "course",
          "localField": "course",
          "foreignField": "_id",
          "as": "course"
        }
      },
      {
        "$unwind": "$course"
      },
      {
        "$lookup": {
          "from": "player",
          "let": { "courseId": "$course._id" },
          "pipeline": [
            {
              "$match": {
                "$expr": {
                  "$eq": ["$course", "$$courseId"]
                }
              }
            },
            {
              "$lookup": {
                "from": "progress",
                "localField": "_id",
                "foreignField": "player",
                "as": "progress"
              }
            },
            {
              "$project": {
                "_id": 1,
                "name": 1,
                "course": 1,
                "progress": 1
              }
            }
          ],
          "as": "players"
        }
      },
      {
        "$addFields": {
          "play.completeCount": {
            "$sum": {
              "$map": {
                "input": "$players",
                "as": "player",
                "in": {
                  "$cond": [
                    {
                      "$eq": [
                        { "$arrayElemAt": ["$$player.progress.status", 0] },
                        "finish"
                      ]
                    },
                    1,
                    0
                  ]
                }
              }
            }
          }
        }
      },
      {
        "$project": {
          "_id": 1,
          "user": 1,
          "course": 1,
          "players": 1,
          "play.completeCount": 1
        }
      }
    ]
  ]
}
