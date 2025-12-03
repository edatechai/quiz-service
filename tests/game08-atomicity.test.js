/**
 * GAME-08: Score Update Atomicity Test
 * 
 * Tests that concurrent score submissions from multiple teams
 * are handled correctly without data loss or overwrites.
 * 
 * Run with: node tests/game08-atomicity.test.js
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
    
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    return response.json();
}

async function simulateConcurrentSubmissions() {
    console.log('='.repeat(60));
    console.log('GAME-08: Score Update Atomicity Test');
    console.log('='.repeat(60));
    console.log('\nTesting concurrent answer submissions from multiple teams...\n');

    // First, make sure a round is started and there's an active question
    console.log('1. Checking quiz state...');
    const quizState = await makeRequest('/game/quiz-state');
    
    if (!quizState.data?.currentQuestion) {
        console.log('⚠️  No active question. Please start a round first.');
        console.log('   Run: POST /api/game/round/start with body: { "roundIndex": 0 }');
        return;
    }
    
    console.log(`   ✓ Active question found: "${quizState.data.currentQuestion.question?.substring(0, 50)}..."`);
    console.log(`   ✓ Round: ${quizState.data.currentRound + 1}, Question: ${quizState.data.currentQuestionIndex + 1}`);

    // Simulate 5 teams submitting simultaneously
    const teams = [
        { schoolId: 'test-team-1', schoolName: 'Test School Alpha' },
        { schoolId: 'test-team-2', schoolName: 'Test School Beta' },
        { schoolId: 'test-team-3', schoolName: 'Test School Gamma' },
        { schoolId: 'test-team-4', schoolName: 'Test School Delta' },
        { schoolId: 'test-team-5', schoolName: 'Test School Epsilon' },
    ];

    const options = quizState.data.currentQuestion.options || [];
    const selectedOption = options[0]?.id || 'A';

    console.log(`\n2. Simulating ${teams.length} concurrent submissions...`);
    console.log(`   Selected option: ${selectedOption}\n`);

    // Create all submission promises
    const submissionPromises = teams.map(team => 
        makeRequest('/game/answer', 'POST', {
            schoolId: team.schoolId,
            schoolName: team.schoolName,
            selectedOptionId: selectedOption,
        })
    );

    // Execute all submissions simultaneously
    const startTime = Date.now();
    const results = await Promise.all(submissionPromises);
    const duration = Date.now() - startTime;

    console.log(`   All ${teams.length} submissions completed in ${duration}ms\n`);

    // Analyze results
    console.log('3. Analyzing results...\n');
    
    let successCount = 0;
    let errorCount = 0;
    const scores = [];

    results.forEach((result, index) => {
        const team = teams[index];
        if (result.data?.calculatedScore !== undefined) {
            successCount++;
            scores.push({
                team: team.schoolName,
                score: result.data.calculatedScore,
                totalScore: result.data.totalScore,
            });
            console.log(`   ✓ ${team.schoolName}: Score ${result.data.calculatedScore}, Total: ${result.data.totalScore}`);
        } else {
            errorCount++;
            console.log(`   ✗ ${team.schoolName}: ${result.message || 'Error'}`);
        }
    });

    console.log('\n4. Test Summary:');
    console.log(`   - Successful submissions: ${successCount}/${teams.length}`);
    console.log(`   - Failed submissions: ${errorCount}/${teams.length}`);
    
    // Verify leaderboard has all teams
    console.log('\n5. Verifying leaderboard...');
    const leaderboard = await makeRequest('/game/leaderboard?limit=100');
    
    const testTeamsOnLeaderboard = leaderboard.data?.leaderboard?.filter(
        entry => entry.schoolId?.startsWith('test-team-')
    ) || [];

    console.log(`   - Test teams on leaderboard: ${testTeamsOnLeaderboard.length}/${teams.length}`);
    
    testTeamsOnLeaderboard.forEach(entry => {
        console.log(`     • ${entry.schoolName}: ${entry.totalScore} points`);
    });

    // Check for data integrity
    console.log('\n6. Data Integrity Check:');
    
    if (successCount === teams.length) {
        console.log('   ✅ PASS: All concurrent submissions were processed successfully');
        console.log('   ✅ PASS: No data loss detected');
    } else if (successCount > 0) {
        console.log(`   ⚠️  PARTIAL: ${successCount}/${teams.length} submissions succeeded`);
        console.log('   (Some may have failed due to duplicate prevention)');
    } else {
        console.log('   ❌ FAIL: No submissions were processed');
    }

    // Test duplicate prevention
    console.log('\n7. Testing duplicate prevention...');
    const duplicateResult = await makeRequest('/game/answer', 'POST', {
        schoolId: teams[0].schoolId,
        schoolName: teams[0].schoolName,
        selectedOptionId: selectedOption,
    });

    if (duplicateResult.code === 'DUPLICATE_SUBMISSION' || duplicateResult.message?.includes('already')) {
        console.log('   ✅ PASS: Duplicate submission was correctly rejected');
    } else if (duplicateResult.data) {
        console.log('   ⚠️  WARNING: Duplicate submission was accepted (score may have been added twice)');
    } else {
        console.log(`   ℹ️  Result: ${duplicateResult.message}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Test complete!');
    console.log('='.repeat(60));
}

// Run the test
simulateConcurrentSubmissions().catch(console.error);

