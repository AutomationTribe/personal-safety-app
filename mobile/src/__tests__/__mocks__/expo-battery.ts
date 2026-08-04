export const getBatteryLevelAsync = jest.fn().mockResolvedValue(1);

export const addBatteryLevelListener = jest.fn().mockReturnValue({ remove: jest.fn() });
