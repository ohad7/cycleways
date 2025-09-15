
/**
 * Test file for route encoding and decoding utilities
 */

// Import the encoding functions
let encodeRoute, decodeRoute;
if (typeof module !== "undefined" && module.exports) {
  // Node.js environment
  const routeEncoding = require("../utils/route-encoding.js");
  encodeRoute = routeEncoding.encodeRoute;
  decodeRoute = routeEncoding.decodeRoute;
} else {
  // Browser environment - functions should be available globally
  // This assumes the route-encoding.js file exports these functions
}

// Mock segments data for testing
const mockSegmentsData = {
  "Test Segment 1": {
    id: 1,
    warning: "Test warning",
  },
  "Test Segment 2": {
    id: 2,
    winter: false,
  },
  "Test Segment 3": {
    id: 3,
    split: [4, 5],
  },
  "Split Segment A": {
    id: 4,
  },
  "Split Segment B": {
    id: 5,
  },
};

/**
 * Test encoding a list of segment IDs to a route string
 */
function testEncodeRoute() {
  console.log("\n--- Test: Encode Route ---");
  
  try {
    const segmentIds = [1, 2, 3];
    const encoded = encodeRoute(segmentIds);
    
    console.log("Input segment IDs:", segmentIds);
    console.log("Encoded route string:", encoded);
    
    // Expected result (placeholder - will be corrected later)
    const expectedEncoded = "ABC123XYZ";
    
    if (encoded === expectedEncoded) {
      console.log("✓ Encoding test passed");
      return true;
    } else {
      console.log(`❌ Encoding test failed. Expected: ${expectedEncoded}, Got: ${encoded}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Encoding test failed with error:", error);
    return false;
  }
}

/**
 * Test decoding a route string to a list of segment names
 */
function testDecodeRoute() {
  console.log("\n--- Test: Decode Route ---");
  
  try {
    // Test string (placeholder - will be corrected later)
    const encodedRoute = "ABC123XYZ";
    const decoded = decodeRoute(encodedRoute, mockSegmentsData);
    
    console.log("Input encoded string:", encodedRoute);
    console.log("Decoded segment names:", decoded);
    
    // Expected result
    const expectedSegments = ["Test Segment 1", "Test Segment 2", "Test Segment 3"];
    
    if (JSON.stringify(decoded) === JSON.stringify(expectedSegments)) {
      console.log("✓ Decoding test passed");
      return true;
    } else {
      console.log(`❌ Decoding test failed. Expected: ${JSON.stringify(expectedSegments)}, Got: ${JSON.stringify(decoded)}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Decoding test failed with error:", error);
    return false;
  }
}

/**
 * Test round-trip encoding and decoding
 */
function testRoundTrip() {
  console.log("\n--- Test: Round-trip Encode/Decode ---");
  
  try {
    const originalSegmentIds = [1, 2, 3];
    
    // Encode
    const encoded = encodeRoute(originalSegmentIds);
    console.log("Original segment IDs:", originalSegmentIds);
    console.log("Encoded:", encoded);
    
    // Decode
    const decoded = decodeRoute(encoded, mockSegmentsData);
    console.log("Decoded segment names:", decoded);
    
    // Convert back to IDs for comparison
    const decodedIds = decoded.map(segmentName => {
      return mockSegmentsData[segmentName]?.id;
    }).filter(id => id !== undefined);
    
    console.log("Decoded IDs:", decodedIds);
    
    if (JSON.stringify(originalSegmentIds) === JSON.stringify(decodedIds)) {
      console.log("✓ Round-trip test passed");
      return true;
    } else {
      console.log(`❌ Round-trip test failed. Original: ${JSON.stringify(originalSegmentIds)}, Decoded: ${JSON.stringify(decodedIds)}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Round-trip test failed with error:", error);
    return false;
  }
}

/**
 * Test empty route handling
 */
function testEmptyRoute() {
  console.log("\n--- Test: Empty Route ---");
  
  try {
    // Test encoding empty array
    const emptyEncoded = encodeRoute([]);
    console.log("Empty array encoded:", emptyEncoded);
    
    if (emptyEncoded === "") {
      console.log("✓ Empty encoding test passed");
    } else {
      console.log(`❌ Empty encoding test failed. Expected: "", Got: "${emptyEncoded}"`);
      return false;
    }
    
    // Test decoding empty string
    const emptyDecoded = decodeRoute("", mockSegmentsData);
    console.log("Empty string decoded:", emptyDecoded);
    
    if (Array.isArray(emptyDecoded) && emptyDecoded.length === 0) {
      console.log("✓ Empty decoding test passed");
      return true;
    } else {
      console.log(`❌ Empty decoding test failed. Expected: [], Got: ${JSON.stringify(emptyDecoded)}`);
      return false;
    }
  } catch (error) {
    console.error("❌ Empty route test failed with error:", error);
    return false;
  }
}

/**
 * Run all route parsing tests
 */
function runAllRouteParsingTests() {
  console.log("=".repeat(60));
  console.log("RUNNING ROUTE PARSING TESTS");
  console.log("=".repeat(60));
  
  const tests = [
    { name: "Encode Route", func: testEncodeRoute },
    { name: "Decode Route", func: testDecodeRoute },
    { name: "Round-trip", func: testRoundTrip },
    { name: "Empty Route", func: testEmptyRoute },
  ];
  
  let passCount = 0;
  let failCount = 0;
  
  tests.forEach(test => {
    try {
      const passed = test.func();
      if (passed) {
        passCount++;
      } else {
        failCount++;
      }
    } catch (error) {
      console.error(`❌ Test "${test.name}" failed with error:`, error);
      failCount++;
    }
  });
  
  console.log("\n" + "=".repeat(60));
  console.log("ROUTE PARSING TEST RESULTS");
  console.log("=".repeat(60));
  console.log(`Total Tests: ${tests.length}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Success Rate: ${((passCount / tests.length) * 100).toFixed(1)}%`);
  console.log("=".repeat(60));
  
  return { passCount, failCount, total: tests.length };
}

// Export functions for Node.js environment
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    testEncodeRoute,
    testDecodeRoute,
    testRoundTrip,
    testEmptyRoute,
    runAllRouteParsingTests,
    mockSegmentsData,
  };
  
  // Auto-run tests if this file is executed directly
  if (require.main === module) {
    runAllRouteParsingTests();
  }
}
