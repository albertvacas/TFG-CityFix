import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { Category } from '../../../generated/prisma';
import { classifyWithGemini, type ClassificationOutput } from './llm';
import { parseAndValidate } from './rules';

/**
 * LangGraph state: el que cada node llegeix i escriu.
 *
 * Per què LangGraph i no funcions encadenades: tot i que ara el graf té dos
 * nodes lineals (LLM → rules), tenir la infraestructura ens deixa la porta
 * oberta a afegir branques sense reescriure: per exemple, un node previ de
 * "router" que decideixi si val la pena cridar Gemini (si no hi ha imatge i
 * la descripció és molt curta, podríem saltar-lo). També facilita observabilitat
 * (LangSmith pot tracejar tot el graf en producció).
 */
const ClassificationState = Annotation.Root({
  // Input
  title: Annotation<string>(),
  description: Annotation<string>(),
  userCategory: Annotation<Category | null>(),
  imageUrl: Annotation<string | null>(),

  // Sortida intermèdia (cru del LLM)
  rawResponse: Annotation<string>(),

  // Sortida final (normalitzada)
  result: Annotation<ClassificationOutput | null>(),
});

/**
 * Node 1: crida a Gemini Flash amb les dades de l'incidència.
 * Retorna el text cru per a que el següent node el normalitzi.
 */
const llmNode = async (
  state: typeof ClassificationState.State,
): Promise<Partial<typeof ClassificationState.State>> => {
  const raw = await classifyWithGemini({
    title: state.title,
    description: state.description,
    userCategory: state.userCategory,
    imageUrl: state.imageUrl,
  });
  return { rawResponse: raw };
};

/**
 * Node 2: parseja, valida i normalitza la sortida del LLM. Sense crides
 * externes, sense LLM — purament determinista.
 */
const rulesNode = (
  state: typeof ClassificationState.State,
): Partial<typeof ClassificationState.State> => {
  const result = parseAndValidate(state.rawResponse);
  return { result };
};

/**
 * Construeix el graf una sola vegada al carregar el mòdul. La compilació de
 * LangGraph valida que tots els nodes/aristes siguin coherents.
 */
const graph = new StateGraph(ClassificationState)
  .addNode('llm', llmNode)
  .addNode('rules', rulesNode)
  .addEdge(START, 'llm')
  .addEdge('llm', 'rules')
  .addEdge('rules', END)
  .compile();

/**
 * API pública del graf: rebre les dades crues d'un report i retornar la
 * classificació final. Una sola crida, sense haver de saber com està
 * construït internament.
 */
export const runClassificationGraph = async (input: {
  title: string;
  description: string;
  userCategory: Category | null;
  imageUrl: string | null;
}): Promise<ClassificationOutput> => {
  const final = await graph.invoke(input);
  if (!final.result) {
    throw new Error('Graf de classificació no ha retornat resultat');
  }
  return final.result;
};
