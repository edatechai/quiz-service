/**
 * LB-05: Announcement Delivery Test
 * 
 * Tests that announcements can be published by admin and fetched by participants.
 * 
 * Run with: node tests/lb05-announcement.test.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:5000/api';

async function makeRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, options);
        const data = await response.json();
        return {
            status: response.status,
            ok: response.ok,
            data
        };
    } catch (error) {
        return {
            status: 0,
            ok: false,
            error: error.message
        };
    }
}

async function testLB05AnnouncementDelivery() {
    console.log('='.repeat(60));
    console.log('LB-05: Announcement Delivery Test');
    console.log('='.repeat(60));
    console.log('\nObjective: Verify announcements can be published and fetched\n');

    let testsPassed = 0;
    let testsFailed = 0;

    // Test 1: Get announcement when none exists
    console.log('Test 1: Get announcement when none exists');
    console.log('-'.repeat(40));

    const emptyResult = await makeRequest('/game/announcement');

    if (emptyResult.status === 200 && emptyResult.data?.data === null) {
        console.log('   ✅ PASS: Returns null when no announcement exists');
        testsPassed++;
    } else if (emptyResult.status === 200) {
        console.log('   ℹ️  INFO: An announcement already exists');
        console.log(`   Message: "${emptyResult.data?.data?.message}"`);
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Unexpected status ${emptyResult.status}`);
        testsFailed++;
    }

    // Test 2: Publish an announcement
    console.log('\nTest 2: Publish announcement');
    console.log('-'.repeat(40));

    const announcement = {
        message: "Test announcement from LB-05 test suite",
        type: "info",
        durationSeconds: 60
    };

    const publishResult = await makeRequest('/game/announcement', 'POST', announcement);

    if (publishResult.status === 200 && publishResult.data?.data?.message === announcement.message) {
        console.log('   ✅ PASS: Announcement published successfully');
        console.log(`   ID: ${publishResult.data.data.id}`);
        console.log(`   Message: "${publishResult.data.data.message}"`);
        console.log(`   Type: ${publishResult.data.data.type}`);
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Publish failed`);
        console.log(`   Response: ${JSON.stringify(publishResult.data)}`);
        testsFailed++;
    }

    // Test 3: Fetch the published announcement
    console.log('\nTest 3: Fetch published announcement');
    console.log('-'.repeat(40));

    const fetchResult = await makeRequest('/game/announcement');

    if (fetchResult.status === 200 && fetchResult.data?.data?.message === announcement.message) {
        console.log('   ✅ PASS: Announcement fetched successfully');
        console.log(`   Message: "${fetchResult.data.data.message}"`);
        console.log(`   Type: ${fetchResult.data.data.type}`);
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Fetch returned unexpected data`);
        console.log(`   Response: ${JSON.stringify(fetchResult.data)}`);
        testsFailed++;
    }

    // Test 4: Verify announcement structure
    console.log('\nTest 4: Verify announcement structure');
    console.log('-'.repeat(40));

    const ann = fetchResult.data?.data;
    const hasRequiredFields = ann &&
        typeof ann.id === 'string' &&
        typeof ann.message === 'string' &&
        typeof ann.type === 'string' &&
        typeof ann.timestamp === 'number' &&
        typeof ann.expiresAt === 'number';

    if (hasRequiredFields) {
        console.log('   ✅ PASS: Announcement has all required fields');
        console.log(`   • id: ${ann.id}`);
        console.log(`   • message: "${ann.message}"`);
        console.log(`   • type: ${ann.type}`);
        console.log(`   • timestamp: ${new Date(ann.timestamp).toISOString()}`);
        console.log(`   • expiresAt: ${new Date(ann.expiresAt).toISOString()}`);
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Announcement missing required fields`);
        console.log(`   Got: ${JSON.stringify(ann)}`);
        testsFailed++;
    }

    // Test 5: Clear announcement
    console.log('\nTest 5: Clear announcement');
    console.log('-'.repeat(40));

    const clearResult = await makeRequest('/game/announcement', 'DELETE');

    if (clearResult.status === 200) {
        console.log('   ✅ PASS: Announcement cleared successfully');
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Clear failed with status ${clearResult.status}`);
        testsFailed++;
    }

    // Test 6: Verify announcement is cleared
    console.log('\nTest 6: Verify announcement is cleared');
    console.log('-'.repeat(40));

    const verifyResult = await makeRequest('/game/announcement');

    if (verifyResult.status === 200 && verifyResult.data?.data === null) {
        console.log('   ✅ PASS: Announcement is now null after clearing');
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Announcement still exists after clearing`);
        testsFailed++;
    }

    // Test 7: Validation - empty message
    console.log('\nTest 7: Validation - empty message rejected');
    console.log('-'.repeat(40));

    const invalidResult = await makeRequest('/game/announcement', 'POST', { message: '' });

    if (invalidResult.status === 400) {
        console.log('   ✅ PASS: Empty message correctly rejected with 400');
        testsPassed++;
    } else {
        console.log(`   ❌ FAIL: Expected 400, got ${invalidResult.status}`);
        testsFailed++;
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('LB-05 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`   Tests Passed: ${testsPassed}/7`);
    console.log(`   Tests Failed: ${testsFailed}/7`);
    console.log('');

    if (testsFailed === 0) {
        console.log('   ✅ LB-05: PASSED');
        console.log('   Announcements can be published, fetched, and cleared correctly.');
    } else {
        console.log('   ❌ LB-05: NEEDS ATTENTION');
        console.log('   Some announcement tests failed.');
    }

    console.log('='.repeat(60));

    return testsFailed === 0;
}

// Run the test
testLB05AnnouncementDelivery()
    .then(passed => process.exit(passed ? 0 : 1))
    .catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
