import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { TrustedContact } from '../../services/CircleService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: (contact: TrustedContact) => void;
}

// Stub — full implementation is a separate task
const AddContactModal = ({ visible, onClose }: Props) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <Text style={styles.label}>Add contact — coming soon</Text>
        <Pressable onPress={onClose} style={styles.btn}>
          <Text style={styles.btnText}>Close</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  label: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', marginBottom: 16 },
  btn: { height: 48, backgroundColor: '#1A6B4A', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

export default AddContactModal;
