import "dotenv/config";
import axios from "axios";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get base URL from environment or use default
// Backend runs on port 5000 or 5001 (check ecosystem.config.cjs)
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.API_URL || `http://localhost:${PORT}/quiz/api`;

async function startRound5() {
    try {
        console.log("🚀 Starting Round 5 (Sudden Death) on backend...");
        console.log(`📍 API URL: ${BASE_URL}`);

        // First, reset the quiz to clear any existing state
        console.log("\n1️⃣ Resetting quiz state...");
        try {
            const resetResponse = await axios.post(`${BASE_URL}/game/reset`);
            console.log("✅ Quiz reset successfully");
        } catch (error) {
            console.log("⚠️ Reset failed (might be okay if quiz was already reset):", error.response?.data?.message || error.message);
        }

        // Wait a moment for reset to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Now start Round 5 (roundIndex = 4)
        console.log("\n2️⃣ Starting Round 5 (roundIndex = 4)...");
        const response = await axios.post(`${BASE_URL}/game/round/start`, {
            roundIndex: 4
        });

        console.log("\n✅ Round 5 started successfully!");
        console.log("📊 Quiz State:", JSON.stringify(response.data.data, null, 2));
        console.log("\n🎯 Both mobile app and web dashboard should now show Round 5");
        
    } catch (error) {
        if (error.response) {
            console.error("\n❌ Error starting Round 5:");
            console.error("Status:", error.response.status);
            console.error("Message:", error.response.data?.message || "Unknown error");
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("\n❌ Network error:", error.message);
            console.error("Make sure the backend server is running on", BASE_URL);
        }
        process.exit(1);
    }
}

startRound5();

