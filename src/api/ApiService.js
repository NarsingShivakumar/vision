import apiService from './AxiosClient';

// ── API helpers ───────────────────────────────────────────────────────────────
const fetchActiveAssistantsApi = async () => {
    const res = await apiService.get('api/assistant/auth/active-assistants');
    return res?.data?.response ?? res?.data ?? [];
};
const submitRegistrationApi = async (payload) => {
    const res = await apiService.post('api/vr/session/start', payload);
    return res?.data ?? res;
};
// v4.1: reassign assistant mid-session — mirrors Angular reassignToAssistant()
const reassignAssistantApi = async (roomCode, assistantId) => {
    const res = await apiService.post(`api/vr/session/${roomCode}/reassign`, { assistantId });
    return res?.data ?? res;
};
//  PDF URI Builder
const getResultPdfUri = (resultId) => {
    if (!resultId) return '';
    // Build full URL from Axios baseURL — mirrors Angular environment.API_ENDPOINT
    const base = (apiService.defaults?.baseURL ?? '').replace(/\/$/, '');
    return `${base}/api/vr/results/${resultId}/pdf`;
};
const fetchResultDataApi = async (id) => {
    // Assuming the base URL is already configured in AxiosClient
    const res = await apiService.get(`api/vr/pdf/data?id=${id}`);
    // Returning the 'response' object directly based on your JSON structure
    console.log("res:::::", res)
    return res?.data?.response ?? null;
};

export {
    fetchActiveAssistantsApi,
    submitRegistrationApi,
    reassignAssistantApi,
    getResultPdfUri,
    fetchResultDataApi,
};