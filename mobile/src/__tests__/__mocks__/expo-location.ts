export const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
};

export const requestForegroundPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });

export const getCurrentPositionAsync = jest.fn().mockResolvedValue({
  coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 15, speed: 0, heading: 0 },
  timestamp: Date.now(),
});

export const watchPositionAsync = jest.fn().mockResolvedValue({ remove: jest.fn() });
