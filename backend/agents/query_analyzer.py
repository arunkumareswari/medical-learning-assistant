# agents/query_analyzer.py
from groq import AsyncGroq
import json

class QueryAnalyzerAgent:
    def __init__(self):
        self.groq_client = AsyncGroq(api_key="YOUR_GROQ_API_KEY")
    
    async def analyze(self, query: str) -> dict:
        """Analyze query intent and requirements"""
        
        prompt = f"""
Analyze this medical student query and return a JSON response:

Query: "{query}"

Determine:
1. query_type: concept_explanation, treatment_protocol, statistics, diagnosis, drug_info
2. medical_domain: cardiology, neurology, pharmacology, etc.
3. complexity: basic, intermediate, advanced
4. needs_current_data: true if query asks for latest/current/recent information
5. temporal_indicators: list of time-related words found
6. confidence: 0.0-1.0

Return ONLY valid JSON, no other text.
"""
        
        response = await self.groq_client.chat.completions.create(
            model="llama-3.1-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a medical query analyzer. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        
        analysis = json.loads(response.choices[0].message.content)
        
        return analysis