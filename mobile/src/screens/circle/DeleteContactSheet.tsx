import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TrustedContact, deleteContact } from '../../services/CircleService';
import { colors, fontSizes, spacing } from '../../styles/tokens';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  contact: TrustedContact | null;
  onClose: () => void;
  onDeleted: (contactId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)} *** ${phone.slice(-3)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

const DeleteContactSheet = ({ visible, contact, onClose, onDeleted }: Props) => {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async () => {
    if (!contact) return;
    setDeleting(true);
    setDeleteError('');

    const result = await deleteContact(contact.id);
    setDeleting(false);

    if (!result.success) {
      setDeleteError(result.error ?? 'Something went wrong. Please try again.');
      return;
    }

    onDeleted(contact.id);
    onClose();
  };

  const handleClose = () => {
    if (deleting) return;
    setDeleteError('');
    onClose();
  };

  if (!contact) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable style={styles.dismissArea} onPress={handleClose} />
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          {/* Icon */}
          <View style={styles.iconWrap}>
            <Feather name="user-minus" size={24} color="#C0392B" />
          </View>

          {/* Title */}
          <Text style={styles.title}>Remove from circle?</Text>

          {/* Body */}
          <Text style={styles.body}>
            <Text style={styles.bodyName}>{contact.name}</Text>
            {' '}will no longer be notified when you travel.{'\n'}They won't receive SOS alerts.
          </Text>

          {/* Contact preview card */}
          <View style={styles.previewCard}>
            <View style={styles.previewAvatar}>
              <Text style={styles.previewAvatarText}>{initials(contact.name)}</Text>
            </View>
            <View style={styles.previewInfo}>
              <Text style={styles.previewName} numberOfLines={1}>{contact.name}</Text>
              <Text style={styles.previewMeta} numberOfLines={1}>
                {contact.relationship}  ·  {maskPhone(contact.phone)}
              </Text>
            </View>
          </View>

          {/* Error */}
          {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}

          {/* Buttons */}
          <View style={styles.buttonsRow}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.cancelBtn, pressed && styles.cancelBtnPressed]}
              onPress={handleClose}
              disabled={deleting}
            >
              <Text style={styles.cancelBtnText}>Keep them</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.deleteBtn,
                deleting && styles.deleteBtnDisabled,
                pressed && !deleting && styles.deleteBtnPressed,
              ]}
              onPress={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.deleteBtnText}>Remove</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.gap20,
    paddingBottom: spacing.gap32,
    alignItems: 'center',
  },

  // Handle
  handleRow: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: spacing.gap20,
  },
  handle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },

  // Icon
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.gap16,
  },

  // Text
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.brand.textPrimary,
    letterSpacing: -0.2,
    marginBottom: spacing.gap8,
    textAlign: 'center',
  },
  body: {
    fontSize: 12,
    color: colors.brand.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.gap20,
  },
  bodyName: {
    fontWeight: '600',
    color: colors.brand.textPrimary,
  },

  // Preview card
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.brand.bgSurface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: spacing.gap12,
    marginBottom: spacing.gap20,
  },
  previewAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E1F5EE',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  previewAvatarText: {
    fontSize: fontSizes.caption,
    fontWeight: '700',
    color: '#085041',
  },
  previewInfo: { flex: 1 },
  previewName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand.textPrimary,
  },
  previewMeta: {
    fontSize: 11,
    color: colors.brand.textSecondary,
    marginTop: 2,
  },

  // Error
  errorText: {
    fontSize: fontSizes.small,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.gap12,
  },

  // Buttons
  buttonsRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: spacing.gap12,
  },
  btn: {
    flex: 1,
    height: spacing.buttonHeight,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: colors.brand.bgSurface,
  },
  cancelBtnPressed: { opacity: 0.7 },
  cancelBtnText: {
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: colors.brand.textSecondary,
  },
  deleteBtn: {
    backgroundColor: '#C0392B',
  },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteBtnPressed: { opacity: 0.85 },
  deleteBtnText: {
    fontSize: fontSizes.body,
    fontWeight: '700',
    color: colors.white,
  },
});

export default DeleteContactSheet;
