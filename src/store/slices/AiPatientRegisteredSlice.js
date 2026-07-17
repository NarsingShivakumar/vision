/**
 * AiPatientRegisteredSlice.js
 */

import { createAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { getEmployee } from "../../api/ApiService";
// import { getEmployee } from "../../ApiService";

const initialState = {
    aiRegisteredPatientData: [],
    aiRegisteredSelectedPatientData: [],
    isLoading: false,
    isSuccess: false,
    isError: false,
    isRegister: false
};

export const aiRegisteredPatient = createAsyncThunk(
    "aiRegisteredPatient",
    async (params = {}, thunkApi) => {
        try {
            // Force isKioskList to true for this specific search endpoint
            const searchParams = { ...params, isKioskList: true };

            // Directly call getEmployee with the search value
            const response = await getEmployee(searchParams);
            console.log({ "response at search slice : ": response });

            // Safely extract the nested data array from the employee API response
            const employeeData = response?.response?.data || [];

            return {
                response: {
                    data: employeeData,
                },
                status: 1,
            };
        } catch (error) {
            console.error("aiRegisteredPatient error", error);
            return thunkApi.rejectWithValue(error);
        }
    }
);

export const clearAiRegisteredPatientData = createAction('aiRegisteredPatient/clearData');

export const AiRegisteredPatientSlice = createSlice({
    name: 'aiRegisteredPatient',
    initialState,
    reducers: {},
    extraReducers: builder => {
        builder.addCase(aiRegisteredPatient.pending, state => {
            state.isLoading = true;
            state.isError = false;
            state.isSuccess = false;
        });

        builder.addCase(aiRegisteredPatient.fulfilled, (state, action) => {
            state.isSuccess = true;
            state.isError = false;
            state.isLoading = false;
            state.aiRegisteredPatientData = action.payload.response.data;
            state.aiRegisteredSelectedPatientData = action.payload.response.data;
            state.isRegister = action.payload.status === 1;
        });

        builder.addCase(aiRegisteredPatient.rejected, state => {
            state.isLoading = false;
            state.isError = true;
            state.isSuccess = false;
        });

        // ── clearAiRegisteredPatientData ─────────────────────────────────────────
        builder.addCase(clearAiRegisteredPatientData, state => {
            state.isLoading = false;
            state.isSuccess = false;
            state.isError = false;
            state.aiRegisteredPatientData = [];
        });
    },
});

export const { reducer: aiRegisteredPatientReducer } = AiRegisteredPatientSlice;