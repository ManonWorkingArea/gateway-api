function builderRender(builder, dynamicData = {}) {
    // Helper function to convert custom width classes to standard CSS
    const convertWidthClass = (widthClass) => {
      switch (widthClass) {
        case "max-w-7xl":
          return "50rem";
        case "max-w-6xl":
          return "40rem";
        case "max-w-full":
          return "100%";
        default:
          return "100%";
      }
    };
  
    // Helper function to compute spacing styles
    const computeSpacingStyle = (spacing) => `
      padding-top: ${spacing.paddingTop || "0"}px;
      padding-right: ${spacing.paddingRight || "0"}px;
      padding-bottom: ${spacing.paddingBottom || "0"}px;
      padding-left: ${spacing.paddingLeft || "0"}px;
      margin-top: ${spacing.marginTop || "0"}px;
      margin-right: ${spacing.marginRight || "0"}px;
      margin-bottom: ${spacing.marginBottom || "0"}px;
      margin-left: ${spacing.marginLeft || "0"}px;
    `;
  
    // Render a single object (e.g., image, header, email body)
    const renderObject = (obj, columnAlignment, dynamicData) => {
      switch (obj.type) {
        case "image":
          return `
            <div style="text-align: ${obj.alignment || "left"}; width: 100%; display: flex; justify-content: ${obj.alignment || "flex-start"};">
              <img 
                src="${obj.url}" 
                alt="${obj.description || "Image"}" 
                style="width: ${obj.width ? `${obj.width}px` : "100%"}; height: auto;" 
              />
            </div>`;
        case "email_body":
          return `<p style="
              text-align: ${columnAlignment || "left"};
              margin: 0;
              line-height: 1.5;
            ">${dynamicData}</p>`;
  
        case "header":
          const convertFontSize = (fontSize) => {
            switch (fontSize) {
              case "xs":
                return "12px";
              case "sm":
                return "14px";
              case "md":
                return "16px";
              case "lg":
                return "18px";
              case "xl":
                return "20px";
              case "2xl":
                return "24px";
              case "3xl":
                return "30px";
              default:
                return fontSize || "16px";
            }
          };
  
          return `<div style="width: 100%;">
            <h1 style="
              text-align: ${obj.align || "left"}; 
              font-size: ${convertFontSize(obj.fontSize)}; 
              font-weight: ${obj.fontWeight || "normal"}; 
              color: ${obj.color || "black"};
              margin: 0;
            ">${obj.text || ""}</h1>
          </div>`;
  
        default:
          return `<div>${obj.description || ""}</div>`;
      }
    };
  
    // Render a single column
    const renderColumn = (column, blockCol, dynamicData) => {
      const columnWidth = 100 / blockCol; // Calculate column width as percentage
      const objectsHTML = column.object
        .map((obj) => renderObject(obj, column.alignment, dynamicData))
        .join("");
  
      return `<div class="column" style="
            width: ${columnWidth}%; 
            background-color: #fff; 
            text-align: ${column.alignment || "left"};
            ${computeSpacingStyle(column)} 
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: ${column.alignment === "center" ? "center" : "flex-start"};
          ">
            ${objectsHTML}
          </div>`;
    };
  
    // Render row-inside (inner container of a row)
    const renderRowInside = (block, columnsHTML) => {
      const maxWidth = convertWidthClass(block.width || "max-w-full");
      return `<div class="row-inside" style="
            max-width: ${maxWidth}; 
            width: 100%; 
            background-color: ${block.bgInnerColor || "transparent"}; 
            display: flex; 
            flex-wrap: wrap;
            ${computeSpacingStyle({
              paddingTop: block.paddingInnerTop,
              paddingRight: block.paddingInnerRight,
              paddingBottom: block.paddingInnerBottom,
              paddingLeft: block.paddingInnerLeft,
            })}
          ">
            ${columnsHTML}
          </div>`;
    };
  
    // Render a single row
    const renderRow = (block, dynamicData) => {
      const columnsHTML = block.columns
        .map((column) => renderColumn(column, block.col, dynamicData))
        .join("");
  
      const rowInsideHTML = renderRowInside(block, columnsHTML);
  
      return `<div class="row" style="
            width: 100%; 
            display: flex; 
            justify-content: center; 
            background-color: ${block.bgColor || "transparent"}; 
            ${computeSpacingStyle(block)} 
          ">
            ${rowInsideHTML}
          </div>`;
    };
  
    // Generate HTML for all rows
    const rowsHTML = builder.map((block) => renderRow(block, dynamicData)).join("");
  
    // Wrap with an email-friendly HTML structure
    const bodyBgColor = builder[0]?.bgColor || "#ffffff"; // Use first row's bgColor for body
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rendered Builder</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap');
          body {
            background-color: ${bodyBgColor};
            font-family: 'Noto Sans Thai', sans-serif;
            margin: 0;
            padding: 0;
          }
          .row {
            width: 100%;
          }
          .column {
            box-sizing: border-box;
          }
        </style>
      </head>
      <body>
        <div>
          ${rowsHTML}
        </div>
      </body>
      </html>
    `;
  }
  
  module.exports = builderRender;
  