import axios from "axios";
import { env } from "../config/env.js";

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

/**
 * Get the DeepSeek API key from environment
 */
function getDeepSeekApiKey() {
	const key = env.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "";
	return key.trim();
}

/**
 * Format the AI Assistant prompt for hints
 */
function formatAIAssistantPrompt(question, options, image = null, audio = null) {
	const optionsText = options
		.map((opt, idx) => {
			const label = opt.label || opt.id || String.fromCharCode(65 + idx);
			return `${label}) ${opt.text}`;
		})
		.join("\n");

	let prompt = `You are an AI assistant helping a human team in a quiz competition. Your role is to provide helpful hints while acknowledging your limitations.

**Your Role:**

- Provide hints that guide the team toward the answer without giving it away directly

- Acknowledge when you're uncertain or when your knowledge might be limited

- Encourage critical thinking rather than blind reliance on your suggestions

- Be supportive but honest about the boundaries of your capabilities

**Parameters Provided:**

- Question: ${question}

- Options:
${optionsText}`;

	if (image) {
		prompt += `\n- Image (if available): ${image}`;
	}

	if (audio) {
		prompt += `\n- Audio (if available): ${audio}`;
	}

	prompt += `

**Guidelines for Your Response:**

1. Analyze the question and options carefully

2. Provide a hint that:

   - Points toward relevant concepts or reasoning paths

   - Doesn't directly state the answer

   - Encourages the team to think critically

3. If you're uncertain, explicitly state your uncertainty

4. If the question involves recent events or information beyond your training data, acknowledge this limitation

5. If an image is provided, describe what you observe but note that image analysis has limitations

6. If audio is provided, describe what you hear (music, sounds, speech, etc.) but note that audio analysis has limitations

7. Remind the team that your suggestions are aids, not definitive answers

8. Keep your entire output to a maximum of 3 sentences

**Response Format:**

- Up to 3 sentences total:

  - Acknowledge the question and provide a concise hint

  - Briefly note any key limitation or uncertainty

  - Encourage the team to apply their own judgment

**Example Tone:**

"I notice this question involves [concept]. Consider thinking about [hint direction]. However, I should note that [limitation/uncertainty]. Ultimately, your team's reasoning and knowledge are what matter most here."

Remember: Your goal is to assist, not replace human thinking.`;

	return prompt;
}

/**
 * Get DeepSeek API payload for AI Assistant
 */
function getAIAssistantApiPayload(question, options, image = null, audio = null) {
	const prompt = formatAIAssistantPrompt(question, options, image, audio);

	return {
		model: "deepseek-chat",
		messages: [
			{
				role: "user",
				content: prompt,
			},
		],
		temperature: 0.7, // Balanced creativity for hints
		max_tokens: 500, // Concise hints
	};
}

/**
 * Get a hint from the AI assistant
 */
export async function getAIHint(question, options, image = null, audio = null) {
	const apiKey = getDeepSeekApiKey();
	
	if (!apiKey) {
		return {
			success: false,
			error: "DEEPSEEK_API_KEY is not configured",
			hint: null,
		};
	}

	try {
		const payload = getAIAssistantApiPayload(question, options, image, audio);

		const response = await axios.post(DEEPSEEK_API_URL, payload, {
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			timeout: 30000, // 30 seconds timeout
		});

		const hint = response.data?.choices?.[0]?.message?.content || "";

		return {
			success: true,
			hint: hint.trim(),
		};
	} catch (error) {
		console.error("Error calling DeepSeek API for hint:", error.message);
		return {
			success: false,
			error: error.message,
			hint: null,
		};
	}
}

