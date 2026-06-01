import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { fetchResultDataApi } from '../../api/ApiService';

// Async thunk to fetch the result data
export const fetchResultData = createAsyncThunk(
    'result/fetchResultData',
    async (id, { rejectWithValue }) => {
        try {
            const data = await fetchResultDataApi(id);
            return data;
        } catch (error) {
            return rejectWithValue(
                error?.response?.data?.message ||
                error?.message ||
                'Failed to fetch result data.'
            );
        }
    }
);

const initialState = {
    data: null,
    loading: false,
    error: null,
};

const resultSlice = createSlice({
    name: 'result',
    initialState,
    reducers: {
        clearResultData: (state) => {
            state.data = null;
            state.error = null;
            state.loading = false;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchResultData.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchResultData.fulfilled, (state, action) => {
                state.loading = false;
                state.data = action.payload;
            })
            .addCase(fetchResultData.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });
    },
});

export const { clearResultData } = resultSlice.actions;
export default resultSlice.reducer;