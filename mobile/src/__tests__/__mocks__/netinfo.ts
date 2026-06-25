export const checkIsOnline = jest.fn().mockResolvedValue(true);
export const useNetworkStatus = jest.fn().mockReturnValue({ isOnline: true });
