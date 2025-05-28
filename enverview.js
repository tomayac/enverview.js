/*

68009668100430824520a3007a11000000000000

30824520a37a4b204fa1000645553ba63e3731fc000000000000000000000000
30824521a37a4c6a5fb900068c9d410c3e3731fc080000000000000000000000
30824522a37a4d925ce900063a8141b33e3731fc080000000000000000000000
30824523a37a45ea748a000733503d193e3731fc000000000000000000000000

8e16

*/

const net = require('net');
const winston = require('winston'); // Added for structured logging

// === User-configurable inverter ID (first panel's ID) ===
const BASE_PANEL_ID = '30824520'; // Change this to your inverter ID (first panel)
const PANEL_COUNT = 4; // Number of panels connected to the inverter

// Microinverter connection details
const INVERTER_IP = '192.168.86.34';
const INVERTER_PORT = 14889;

// Configure Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() // Output logs as JSON
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Add colors for readability
        winston.format.simple() // Use simple format for console
      )
    })
    // Add other transports here if needed (e.g., file transport)
    // new winston.transports.File({ filename: 'inverter.log' })
  ],
});


// Function to generate payload based on inverter ID
function createTriggerPayload(inverterId) {
  const prefix = '1077';
  const padding = '000000000000000000000000';
  const trailer = 'e316';

  const payloadString = `${prefix}${inverterId}${padding}${trailer}`;
  logger.debug(`Generated payload string: ${payloadString}`);
  return Buffer.from(payloadString, 'ascii');
}

// Generate sequential panel IDs based on base panel ID
function generatePanelIds(baseId, count = PANEL_COUNT) {
  const ids = [];
  const numericBase = parseInt(baseId, 10);
    if (isNaN(numericBase)) {
        logger.error("Invalid BASE_PANEL_ID. Please provide a numeric string.", { baseId });
        return ids;
    }
  for (let i = 0; i < count; i++) {
    ids.push((numericBase + i).toString());
  }
  logger.debug(`Generated panel IDs: ${ids.join(', ')}`, { baseId, count });
  return ids;
}

// Helper function to decode scaled integer values (2 bytes, Little-Endian)
function decodeValue(buffer, offset, scale = 100, fieldName = 'value') {
  try {
    // Ensure we have enough bytes to read
    if (offset + 2 > buffer.length) {
      logger.warn(`Not enough data in buffer to decode ${fieldName}`, { offset, bufferLength: buffer.length });
      return null;
    }
    // Use readUInt16LE for Little-Endian
    const rawValue = buffer.readUInt16LE(offset);
    return rawValue / scale;
  } catch (e) {
    logger.error(`Error decoding ${fieldName} at offset ${offset}: ${e.message}`, { offset, scale });
    return null; // Return null on error
  }
}

// Function to parse and print panel data clearly
function parseAndPrintPanelData(hexData, panelIds) {
  const buffer = Buffer.from(hexData, 'hex');
  logger.info(`Processing ${buffer.length} bytes of data.`);

  // --- Define segment lengths based on observed structure ---
  // These might need adjustment based on more data samples
  const openingSegmentLength = 22; // Example: 680096681004 + BASE_PANEL_ID (8 bytes) = 22
  const closingSegmentLength = 2;  // Example: 8e16 (or similar trailer)

  if (buffer.length < openingSegmentLength + closingSegmentLength) {
      logger.warn("Received data is too short to contain valid segments.", { dataLength: buffer.length });
      return;
  }

  const openingSegmentHex = buffer.slice(0, openingSegmentLength).toString('hex');
  logger.info('📦 Opening Segment', { hex: openingSegmentHex });

  // Isolate the block containing data for all panels
  const panelDataBuffer = buffer.slice(openingSegmentLength, buffer.length - closingSegmentLength);
  // Assume equal segment length per panel based on PANEL_COUNT
  const expectedPanelDataLength = panelDataBuffer.length;
  const panelSegmentLength = expectedPanelDataLength / panelIds.length;

  logger.info(`Total panel data length: ${expectedPanelDataLength} bytes, Segment length per panel: ${panelSegmentLength} bytes.`);

  if (!Number.isInteger(panelSegmentLength) || panelSegmentLength <= 0) {
      logger.error("Calculated panel segment length is invalid. Check PANEL_COUNT or received data structure.", { panelSegmentLength, expectedPanelDataLength, panelCount: panelIds.length });
      return;
  }


  for (let i = 0; i < panelIds.length; i++) {
    const segmentStart = i * panelSegmentLength;
    const segmentEnd = segmentStart + panelSegmentLength;
    const segmentBuffer = panelDataBuffer.slice(segmentStart, segmentEnd);

    // --- Basic Info ---
    const idLength = panelIds[i].length; // Usually 8 bytes
    if (segmentBuffer.length < idLength + 2) { // Need at least ID + 2 firmware bytes
        logger.warn(`Segment buffer for panel ${i+1} is too short for basic info.`, { segmentLength: segmentBuffer.length });
        continue;
    }
    const id = segmentBuffer.slice(0, idLength).toString('ascii');
    const firmwareMajor = segmentBuffer[idLength];     // Byte right after ID
    const firmwareMinor = segmentBuffer[idLength + 1]; // Next byte

    // --- Define Offsets within the 10-byte data block relative to start of segment ---
    // These assume the 10-byte data block starts immediately after the 2 firmware bytes
    const dataBlockStartOffset = idLength + 2;
    const tempOffset = dataBlockStartOffset + 0;      // Bytes 1-2 of data block
    const acPowerOffset = dataBlockStartOffset + 2;   // Bytes 3-4 of data block
    const unknown1Offset = dataBlockStartOffset + 4;  // Bytes 5-6 of data block
    const unknown2Offset = dataBlockStartOffset + 6;  // Bytes 7-8 of data block
    const dcVoltageOffset = dataBlockStartOffset + 8; // Bytes 9-10 of data block

    // --- Decode Values ---
    // Note: Validity/consistency across panels might vary based on previous analysis!
    const temperature = decodeValue(segmentBuffer, tempOffset, 100, 'Temperature');
    const acPower = decodeValue(segmentBuffer, acPowerOffset, 100, 'AC Power');
    const unknownVal1 = decodeValue(segmentBuffer, unknown1Offset, 1, 'Unknown1'); // Assume no scaling for unknown
    const unknownVal2 = decodeValue(segmentBuffer, unknown2Offset, 1, 'Unknown2'); // Assume no scaling for unknown
    const dcVoltage = decodeValue(segmentBuffer, dcVoltageOffset, 100, 'DC Voltage');


    logger.info(`--- Panel ${i + 1} ---`, {
      panelId: id,
      segmentHex: segmentBuffer.toString('hex'),
      firmware: `${firmwareMajor}/${firmwareMinor}`,
      decoded: {
        // Add units or notes based on analysis
        temperature_C: temperature, // Note: May be inconsistent across panels
        acPower_W: acPower,         // Note: Seems most likely field
        dcVoltage_V: dcVoltage,     // Note: May be inconsistent across panels
        unknown_16bit_1: unknownVal1 !== null ? segmentBuffer.slice(unknown1Offset, unknown1Offset + 2).toString('hex') : 'N/A',
        unknown_16bit_2: unknownVal2 !== null ? segmentBuffer.slice(unknown2Offset, unknown2Offset + 2).toString('hex') : 'N/A',
      }
    });
  }

  const closingSegmentHex = buffer.slice(buffer.length - closingSegmentLength).toString('hex');
  logger.info(`📦 Closing Segment`, { hex: closingSegmentHex });
}

// Create payload with configurable inverter ID
const panelIds = generatePanelIds(BASE_PANEL_ID, PANEL_COUNT);
if (panelIds.length === 0) {
    logger.error("Could not generate panel IDs. Exiting.");
    process.exit(1); // Exit if IDs can't be generated
}
const TRIGGER_PAYLOAD = createTriggerPayload(BASE_PANEL_ID);


// Connect to the microinverter
logger.info(`Attempting connection to microinverter...`, { host: INVERTER_IP, port: INVERTER_PORT });
const client = net.createConnection({ host: INVERTER_IP, port: INVERTER_PORT }, () => {
  logger.info('✅ Connected to microinverter', { host: INVERTER_IP, port: INVERTER_PORT });

  // Send the trigger payload
  client.write(TRIGGER_PAYLOAD);
  logger.info('🚀 Sent trigger payload', { payload: TRIGGER_PAYLOAD.toString(), hexPayload: TRIGGER_PAYLOAD.toString('hex') });
});

// Listen for data from microinverter
client.on('data', (data) => {
  const hexData = data.toString('hex');
  logger.info(`📥 Raw data received (${data.length} bytes)`, { hex: hexData });

  // Regenerate IDs in case BASE_PANEL_ID was invalid initially but corrected
  const currentPanelIds = generatePanelIds(BASE_PANEL_ID, PANEL_COUNT);
   if (currentPanelIds.length > 0) {
       parseAndPrintPanelData(hexData, currentPanelIds);
   } else {
        logger.error("Cannot parse data without valid panel IDs.");
   }
});

// Handle connection closure
client.on('end', () => {
  logger.info('🚫 Connection ended by microinverter.');
});

// Handle connection errors
client.on('error', (err) => {
  // Log the error object for more details
  logger.error('⚠️ Connection Error', { message: err.message, code: err.code, stack: err.stack });
});

// Handle process exit signals
process.on('SIGINT', () => {
    logger.info("SIGINT received, closing connection.");
    client.end();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info("SIGTERM received, closing connection.");
    client.end();
    process.exit(0);
});