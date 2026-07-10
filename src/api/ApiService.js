import apiService from './AxiosClient';

// ── API helpers ───────────────────────────────────────────────────────────────
const fetchActiveAssistantsApi = async () => {
    const res = await apiService.get('api/v1/assistant/auth/active-assistants');
    // console.log("fetchActiveAssistantsApi", res)
    return res?.data?.response ?? res?.data ?? [];
};
const submitRegistrationApi = async (payload) => {
    const res = await apiService.post('api/v1/vision/newsession', payload);
    return res?.data ?? res;
};
// v4.1: reassign assistant mid-session — mirrors Angular reassignToAssistant()
const reassignAssistantApi = async (roomCode, assistantId) => {
    const res = await apiService.post(
        'api/v1/vision/reassign',
        { params: { roomCode, assistantId } }
    );
    return res?.data ?? res;
};
//  PDF URI Builder
const getResultPdfUri = (resultId) => {
    if (!resultId) return '';
    // Build full URL from Axios baseURL — mirrors Angular environment.API_ENDPOINT
    const base = (apiService.defaults?.baseURL ?? '').replace(/\/$/, '');
    // return `${base}api/v1/vision/results/${resultId}/pdf`;
    return `${base}/api/v1/vision/results/pdf?id=${encodeURIComponent(resultId)}`;
};
const fetchResultDataApi = async (id) => {
    // Assuming the base URL is already configured in AxiosClient
    const res = await apiService.get(`api/v1/vision/view/pdf?id=${id}`);
    // Returning the 'response' object directly based on your JSON structure
    console.log("res:::::", res)
    return res?.data?.response ?? null;
};
const kioskSetupApi = async (kioskId, password, regId) => {
    try {
        const response = await apiService.get(
            'api/v1/twelvelead/ecg/kiosk/check',
            {
                params: {
                    kioskId: kioskId,
                    // password: password,
                    // regId: regId,
                }
            }
        );

        console.log("kiosk login", response);
        return response.data;

    } catch (error) {
        console.error("An error occurred in kioskSetupApi:", error);
        throw error;
    }
};
const sendPatientDetailsList = async (patientDTO) => {
    try {

        const response1 = await apiService.post('api/v1/patient/registration', patientDTO);

        console.log("response1:::::", response1)

        if (response1 != null) {
            const responseData = response1.data;
            console.log('registration save :', responseData);

            return responseData;

        }

    } catch (error) {
        console.error('Error fetching patient list:', error);
        throw { error }; // Rethrow the error to handle it in the component
    }
};
const getDepartments = async () => {
    const response = await apiService.get("api/v1/master/departmentlist");
    console.log("getDepartments:", response)
    return response.data;
};
const getDesignations = async () => {
    const response = await apiService.get("api/v1/employees/designations");
    console.log("getDesignations:", response)
    return response.data;
};
const sendEmployeeDetailsList = async (employeeDTO) => {
    try {
        console.log('employees registration sendEmployeeDetailsList :', employeeDTO);
        const response1 = await apiService.post('api/v1/employees', employeeDTO);
        console.log('employees registration response1 :', response1);
        if (response1 != null) {
            const responseData = response1.data;
            console.log('employees registration response1 :', responseData);

            return responseData;

        }

    } catch (error) {
        console.error('Error fetching patient list:', error);
        throw { error }; // Rethrow the error to handle it in the component
    }
};
const checkAssistantDeclineApi = async (username) => {
    try {
        const res = await apiService.post('api/v1/assistant/auth/decline', { params: { username } });
        console.log('employees checkAssistantDeclineApi :', res);
        return res?.data ?? res;
    } catch (error) {
        // Fallback in case the decline status returns as an HTTP error
        // console.error('Error fetching checkAssistantDeclineApi :', error);
        return error?.response?.data ?? null;
    }
};

export {
    fetchActiveAssistantsApi,
    submitRegistrationApi,
    reassignAssistantApi,
    getResultPdfUri,
    fetchResultDataApi,
    kioskSetupApi,
    sendPatientDetailsList,
    getDepartments,
    getDesignations,
    sendEmployeeDetailsList,
    checkAssistantDeclineApi,
};
