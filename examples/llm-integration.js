// LLM-ə qoşma nümunəsi - OpenAI / OpenAI-uyğun LLM üçün
// Bu kod LLM-in tool çağırışını necə yerinə yetirəcəyini göstərir

const SEARCH_API_URL = "https://SENIN-PROEKTIN.vercel.app/api/search"; // Vercel deploy-dan sonra dəyiş

export const qaqaSearchTool = {
  type: "function",
  function: {
    name: "qaqa_search",
    description: "Key-siz veb axtarışı. Sual verildikdə bir neçə saytı gəzib təmiz JSON qaytarır. Hava üçün Open-Meteo istifadə edir.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Axtarış sualı" },
        max_results: { type: "integer", default: 5, minimum: 1, maximum: 8 },
        format: { type: "string", enum: ["json", "jsonl"], default: "json" }
      },
      required: ["query"]
    }
  }
};

export async function callQaqaSearch(args) {
  const res = await fetch(SEARCH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const data = await res.json();
  // data.results-i LLM-ə qaytar, o [1], [2] ilə cavab versin
  return data;
}

// Nümunə: LLM tool çağırdıqda
// const result = await callQaqaSearch({ query: "Bakı hava bu gün", max_results: 5 });
// console.log(result.results.map(r => `[${r.id}] ${r.title} - ${r.url}\n${r.content}`).join("\n\n"));
// Sonra bu mətni LLM-ə ver: "Bu mənbələrə əsaslanaraq cavab ver, hər fakt üçün [1] [2] yaz"
