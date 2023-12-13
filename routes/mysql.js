const express = require('express');
const mariadb = require('mariadb');

module.exports = function (clientConfig, connections) {
  const router = express.Router();

  connections.forEach(connectionItem => {
    const { clientToken, connection } = connectionItem;

    function setCustomHeader(req, res, next) {
        const data      = global.ClientConfiguration;
        const foundData = data.find(item => item.clientToken === clientToken);
        res.set('X-Client-Token', clientToken);
        res.set('X-Client-Source', foundData.source);
        res.set('X-Client-Name', foundData.clientId);
        next();
    }

    router.post(`/${clientToken}/query`, setCustomHeader, async (req, res) => {
      const { clientToken: urlClientToken, query } = req.body;
    
      if (!query) {
        return res.status(400).send('Query parameter is required', query);
      }
    
      try {
        const { mainQuery, countQuery } = query;
    
        // Initialize variables
        let countResults;
        let totalItems;
    
        // Execute the main query to retrieve the data
        const results = await executeQuery(connection, mainQuery);
    
        
    
        res.send({
          data: results,
          totalItems: totalItems,
        });
      } catch (error) {
        console.error(error); // Log the error message for debugging
        res.status(500).send('Error executing query: ' + error.message);
      }
    });    

  });

async function executeQuery(connection, query) {
  let conn;

  try {
    conn = await mariadb.createConnection(connection);
    const result = await conn.query(query);

    // Convert BigInt values to strings in the result
    const convertedResult = result.map(row => {
      const convertedRow = { ...row };
      for (const column in convertedRow) {
        if (typeof convertedRow[column] === 'bigint') {
          convertedRow[column] = convertedRow[column].toString();
        }
      }
      return convertedRow;
    });

    return convertedResult;
  } catch (error) {
    throw error;
  } finally {
    if (conn) {
      conn.end();
    }
  }
}

  
  return router;
}
